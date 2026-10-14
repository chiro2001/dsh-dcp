/**
 * Session-level DCP statistics: a signed, auditable ledger recomputed from the
 * log (M7.0 semantics, round-0004).
 *
 * @module dsh-dcp/stats/session
 */

import { isDcpSource } from '../protocol/source.js'

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
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
    .join('\n')
}

const INLINE_CLEANUP_MARKER =
  /^<dcp-inline-cleanup provenance="dsh-dcp" status="(?:committed" block-ref="b\d+"|rejected" code="[A-Z0-9_]{1,48}") \/>$/
const LEGACY_INLINE_CLEANUP_MARKER = /^\[stored\s+in\s+b(?:\d+|n)\]$/i

function isInlineCleanupMarker(text: string): boolean {
  return (
    INLINE_CLEANUP_MARKER.test(text.trim()) || LEGACY_INLINE_CLEANUP_MARKER.test(text.trim())
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Identify a cleanup marker in the parsed arguments of a compress call. */
function hasInlineCleanupMarker(argumentsText: string): boolean {
  try {
    const parsed: unknown = JSON.parse(argumentsText)
    if (!isRecord(parsed)) return false
    if (
      Object.keys(parsed).length === 1 &&
      typeof parsed.dcpCleanup === 'string' &&
      isInlineCleanupMarker(parsed.dcpCleanup)
    ) {
      return true
    }
    if (!Array.isArray(parsed.content)) return false
    return parsed.content.some(
      (entry) =>
        isRecord(entry) &&
        typeof entry.summary === 'string' &&
        isInlineCleanupMarker(entry.summary),
    )
  } catch {
    return false
  }
}

/**
 * Require the exact DCP cleanup shape: one assistant node replaces one prior
 * assistant node, and the replacement carries a marker inside compress args.
 */
function isInlineCleanupAssistantReplacement(
  events: readonly SessionEvent[],
  prune: Extract<SessionEvent, { type: 'compaction/prune' }>,
  next: SessionEvent | undefined,
): next is Extract<SessionEvent, { type: 'assistant/message' }> {
  if (next?.type !== 'assistant/message') return false
  if (
    next.surfaceOp === undefined ||
    next.surfaceOp === 'append' ||
    next.surfaceOp.op !== 'replace'
  ) {
    return false
  }
  const sources = next.sourceEventSeqs ?? []
  if (
    sources.length !== 1 ||
    prune.data.shadowedSeqs.length !== 1 ||
    sources[0] !== prune.data.shadowedSeqs[0]
  ) {
    return false
  }
  if (next.surfaceOp.startSeq !== sources[0] || next.surfaceOp.endSeq !== sources[0])
    return false
  const previous = events.find((event) => event.seq === sources[0])
  if (previous?.type !== 'assistant/message') return false
  if (next.data.message.id !== previous.data.message.id) return false
  const previousCompressCalls = previous.data.message.content.filter(
    (block) => block.type === 'tool-call' && block.name === 'compress',
  )
  if (previousCompressCalls.length === 0) return false
  return next.data.message.content.some(
    (block) =>
      block.type === 'tool-call' &&
      previousCompressCalls.some(
        (previousBlock) => previousBlock.type === 'tool-call' && previousBlock.id === block.id,
      ) &&
      hasInlineCleanupMarker(block.arguments),
  )
}

/**
 * Recognize the deferred dsh >= 0.1.5 cleanup shape: one prune shadow price
 * followed by a plugin-source user/message cleanup record replacing the whole
 * compress call/result span.
 */
function isStepCleanupUserReplacement(
  events: readonly SessionEvent[],
  prune: Extract<SessionEvent, { type: 'compaction/prune' }>,
  next: SessionEvent | undefined,
): next is Extract<SessionEvent, { type: 'user/message' }> {
  if (next?.type !== 'user/message') return false
  if (
    next.surfaceOp === undefined ||
    next.surfaceOp === 'append' ||
    next.surfaceOp.op !== 'replace'
  ) {
    return false
  }
  if (!isDcpSource(next.data.source) || !textOf(next.data).includes('<dcp-cleanup')) {
    return false
  }
  const sources = next.sourceEventSeqs ?? []
  if (
    sources.length === 0 ||
    sources.length !== prune.data.shadowedSeqs.length ||
    sources.some((seq, index) => seq !== prune.data.shadowedSeqs[index]) ||
    next.surfaceOp.startSeq !== sources[0] ||
    next.surfaceOp.endSeq !== sources.at(-1)
  ) {
    return false
  }
  return prune.data.shadowedSeqs.some((seq) => {
    const event = events.find((candidate) => candidate.seq === seq)
    return (
      event?.type === 'assistant/message' &&
      event.data.message.content.some(
        (block) => block.type === 'tool-call' && block.name === 'compress',
      )
    )
  })
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
        const isDcpStrategy =
          (next?.type === 'tool/result' && nextText.includes('[duplicate ')) ||
          (next?.type === 'user/message' && nextText.startsWith('[errored tool unit removed]'))
        const isDcpInlineCleanup =
          isInlineCleanupAssistantReplacement(events, event, next) ||
          isStepCleanupUserReplacement(events, event, next)
        const isDcp = isDcpStrategy || isDcpInlineCleanup
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
        if (decoded.ok) {
          if (decoded.meta.kind === 'expansion') {
            blockCount++
            const oldSeq = event.sourceEventSeqs?.[0]
            const old =
              oldSeq === undefined
                ? undefined
                : events.find((candidate) => candidate.seq === oldSeq)
            const oldEstimate = old?.type === 'user/message' ? estimate(old.data) : 0
            expansionTokens += oldEstimate - estimate(event.data)
          } else {
            // Summary checkpoint message is priced via its compaction/summary; the
            // replacement text is not double-counted here.
          }
        }
        if (isDcpSource(event.data.source) && event.surfaceOp === 'append' && !decoded.ok) {
          markerTokens += estimate(event.data)
        }
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
