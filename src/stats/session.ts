/**
 * Session-level DCP statistics: a signed, auditable ledger recomputed from the
 * log (M7.0 semantics, round-0004).
 *
 * @module dsh-dcp/stats/session
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Message } from '@deepseek-ai/dsh-llm'
import { decodeDcpMeta } from '../protocol/metadata.js'
import { reconcileBlockMembership } from '../protocol/replacements.js'

export interface SessionStats {
  /** Historical DCP summary + expansion transactions. */
  blockCount: number
  /** Active DCP blocks on the current surface. */
  activeBlockCount: number
  /** DCP prune replacements. */
  pruneReplacements: number
  /** Gross heuristic tokens shadowed by DCP summaries. */
  shadowedTokens: number
  /** Heuristic tokens of DCP checkpoints and prune replacements. */
  checkpointTokens: number
  /** Heuristic tokens removed by DCP prunes (original results). */
  pruneTokens: number
  /** Signed heuristic delta of semantic expansions (negative = overhead). */
  expansionTokens: number
  /** Heuristic tokens of boundary markers. */
  markerTokens: number
  /** Signed estimated history reduction: shadowed + prune - checkpoint + expansion - marker. */
  historyReduction: number
}

function heuristicTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4))
}

function textOf(message: Message): string {
  return message.content
    .flatMap((block): Array<{ type: string; text?: string }> =>
      block.type === 'tool-result'
        ? (block.content as Array<{ type: string; text?: string }>)
        : [block as { type: string; text?: string }],
    )
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
    .join('\n')
}

export function computeSessionStats(
  events: readonly SessionEvent[],
  estimateMessage?: (message: Message) => number,
): SessionStats {
  const estimate = estimateMessage ?? ((message: Message) => heuristicTokens(textOf(message)))
  let blockCount = 0
  let pruneReplacements = 0
  let shadowedTokens = 0
  let checkpointTokens = 0
  let pruneTokens = 0
  let expansionTokens = 0
  let markerTokens = 0

  for (let index = 0; index < events.length; index++) {
    const event = events[index]!
    switch (event.type) {
      case 'compaction/summary': {
        const next = events[index + 1]
        const decoded =
          next?.type === 'user/message' && next.surfaceOp !== 'append'
            ? decodeDcpMeta(next.data.source)
            : undefined
        if (decoded?.ok && decoded.meta.kind === 'summary') {
          shadowedTokens += event.data.shadowedTokenCount
          if (next?.type === 'user/message') {
            checkpointTokens += estimate(next.data)
          }
          blockCount++
        }
        break
      }
      case 'compaction/prune': {
        const next = events[index + 1]
        const nextText =
          next?.type === 'tool/result' || next?.type === 'assistant/message'
            ? textOf(next.data.message)
            : next?.type === 'user/message'
              ? textOf(next.data)
              : ''
        const isDcp =
          nextText.includes('[duplicate ') || nextText.includes('[errored tool unit removed]')
        if (isDcp) {
          pruneTokens += event.data.shadowedTokenCount
          if (next?.type === 'tool/result' || next?.type === 'assistant/message') {
            checkpointTokens += estimate(next.data.message)
          } else if (next?.type === 'user/message') {
            checkpointTokens += estimate(next.data)
          }
          pruneReplacements++
        }
        break
      }
      case 'user/message': {
        const decoded = decodeDcpMeta(event.data.source)
        const text = textOf(event.data)
        if (decoded.ok) {
          if (decoded.meta.kind === 'expansion') {
            blockCount++
            const oldSeq = event.sourceEventSeqs?.[0]
            const old = oldSeq === undefined ? undefined : events[oldSeq]
            const oldEstimate = old?.type === 'user/message' ? estimate(old.data) : 0
            expansionTokens += oldEstimate - estimate(event.data)
          } else {
            // Summary checkpoint message is priced via its compaction/summary; the
            // replacement text is not double-counted here.
          }
        }
        if (text.includes('<dcp-boundary')) markerTokens += estimate(event.data)
        break
      }
    }
  }

  const activeBlockCount = reconcileBlockMembership(events).size
  return {
    blockCount,
    activeBlockCount,
    pruneReplacements,
    shadowedTokens,
    checkpointTokens,
    pruneTokens,
    expansionTokens,
    markerTokens,
    historyReduction:
      shadowedTokens + pruneTokens - checkpointTokens + expansionTokens - markerTokens,
  }
}
