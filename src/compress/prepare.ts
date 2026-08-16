/**
 * Range preparation: resolve refs, validate cuts/retention, compute net
 * savings, and build the checkpoint text.
 *
 * @module dsh-dcp/compress/prepare
 */

import { deriveEventMessage, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { DcpConfig } from '../config.js'
import type { DcpReplayState } from '../protocol/replay.js'
import { resolveRange } from '../refs/resolver.js'
import { collectProtectedAppendix } from '../protection/classify.js'
import type { CompressRangeEntry } from './schema.js'

export interface PreparedRange {
  entry: CompressRangeEntry
  topic: string
  startSeq: number
  endSeq: number
  startPosition: number
  endPosition: number
  shadowedSeqs: number[]
  tokensIn: number
  tokensOut: number
  checkpointText: string
  protectedKinds: string[]
}

export type PrepareResult =
  { ok: true; prepared: PreparedRange } | { ok: false; errors: string[] }

export function buildCheckpointText(
  blockRef: string,
  summary: string,
  protectedAppendix = '',
): string {
  const body = summary.trim()
  return `[Compressed conversation section]\n${body}${protectedAppendix}\n\n<dcp-message-id>${blockRef}</dcp-message-id>`
}

function turnOfSeq(events: readonly SessionEvent[], seq: number): number | undefined {
  let currentTurn: number | undefined
  for (let index = 0; index <= seq && index < events.length; index++) {
    const event = events[index]!
    if (event.type === 'turn/start') currentTurn = event.data.turn
    if (event.type === 'turn/end') currentTurn = undefined
    if (index === seq) {
      if (event.type === 'assistant/message' || event.type === 'tool/result') {
        return event.data.turn
      }
      return currentTurn
    }
  }
  return undefined
}

export function prepareRange(
  session: Session,
  tokenMeter: TokenMeter,
  config: DcpConfig,
  state: DcpReplayState,
  entry: CompressRangeEntry,
  blockRef: string,
  topic: string,
): PrepareResult {
  const surface = [...session.surface.nodes]
  const resolved = resolveRange(surface, state.boundaryRefs, entry.startRef, entry.endRef)
  if (!resolved.ok) return { ok: false, errors: [resolved.reason] }

  const shadowedSeqs = surface.slice(resolved.startPosition, resolved.endPosition)
  if (shadowedSeqs.length === 0) {
    return { ok: false, errors: [`range ${entry.startRef}..${entry.endRef} is empty`] }
  }

  if (!toolPairingBalancedBefore(session, resolved.startSeq)) {
    return {
      ok: false,
      errors: [`range start ${entry.startRef} cuts an open tool call/result pair`],
    }
  }
  if (!toolPairingBalancedBefore(session, resolved.endSeq)) {
    return {
      ok: false,
      errors: [`range end ${entry.endRef} cuts an open tool call/result pair`],
    }
  }

  // Retention: keep the most recent N turns verbatim.
  const events = session.events
  const turns = shadowedSeqs
    .map((seq) => turnOfSeq(events, seq))
    .filter((turn): turn is number => turn !== undefined)
  const latestTurn = Math.max(0, ...surface.map((seq) => turnOfSeq(events, seq) ?? 0))
  const maxShadowedTurn = Math.max(0, ...turns)
  if (maxShadowedTurn > latestTurn - config.compress.retainRecentTurns) {
    return {
      ok: false,
      errors: [
        `range ${entry.startRef}..${entry.endRef} enters the last ${config.compress.retainRecentTurns} turn(s); choose older content`,
      ],
    }
  }

  // Nested/atomic checkpoints are M2; refuse ranges containing checkpoints now.
  const activeBlockSeqs = new Set(
    state.blocks.filter((block) => block.membership === 'active').map((block) => block.seq),
  )
  for (const seq of shadowedSeqs) {
    if (activeBlockSeqs.has(seq)) {
      return {
        ok: false,
        errors: [
          `range ${entry.startRef}..${entry.endRef} contains active compression block; nesting lands in M2`,
        ],
      }
    }
  }

  const tokensIn = shadowedSeqs.reduce((sum, seq) => {
    const message = deriveEventMessage(events[seq]!)
    return sum + (message ? tokenMeter.estimateMessage(message) : 0)
  }, 0)

  const appendix = collectProtectedAppendix(session, shadowedSeqs, config)
  const checkpointText = buildCheckpointText(blockRef, entry.summary, appendix.text)
  const checkpointMessage = createUserMessage({
    content: [{ type: 'text', text: checkpointText }],
    source: { kind: 'plugin', plugin: 'dsh-dcp' },
  })
  const tokensOut = tokenMeter.estimateMessage(checkpointMessage)
  if (tokensIn - tokensOut < config.compress.minNetSavingsTokens) {
    return {
      ok: false,
      errors: [
        `range ${entry.startRef}..${entry.endRef} saves ~${tokensIn - tokensOut} tokens, below minNetSavingsTokens=${config.compress.minNetSavingsTokens}`,
      ],
    }
  }

  return {
    ok: true,
    prepared: {
      entry,
      topic,
      startSeq: resolved.startSeq,
      endSeq: resolved.endSeq,
      startPosition: resolved.startPosition,
      endPosition: resolved.endPosition,
      shadowedSeqs,
      tokensIn,
      tokensOut,
      checkpointText,
      protectedKinds: appendix.kinds,
    },
  }
}
