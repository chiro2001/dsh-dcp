/**
 * Range preparation: resolve refs, validate cuts/retention, compute net
 * savings, and build the checkpoint text.
 *
 * @module dsh-dcp/compress/prepare
 */

import { deriveEventMessage, type Session } from '@deepseek-ai/dsh-session'
import { toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { DcpConfig } from '../config.js'
import type { DcpReplayState } from '../protocol/replay.js'
import { resolveRange } from '../refs/resolver.js'
import { turnOfSeq } from '../protocol/turns.js'
import {
  collectProtectedAppendix,
  hardProtectedForm,
  type PriorBlock,
} from '../protection/classify.js'
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
  consumedBlockRefs: string[]
  blockRef: string
}

export type PrepareResult =
  { ok: true; prepared: PreparedRange } | { ok: false; errors: string[] }

export function buildCheckpointText(
  blockRef: string,
  summary: string,
  protectedAppendix = '',
): string {
  // The model sometimes prefixes summary prose with the assigned block ref
  // (e.g. "[b2] user asked ...").  Only <dcp-message-id> carries the block
  // identity; strip such a leading marker so the checkpoint text stays clean.
  const body = summary.trim().replace(/^\[b\d+\]\s*/, '')
  return `[Compressed conversation section]\n${body}${protectedAppendix}\n\n<dcp-message-id>${blockRef}</dcp-message-id>`
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
  const resolved = resolveRange(
    surface,
    state.boundaryRefs,
    entry.startRef,
    entry.endRef,
    state.aliases,
  )
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

  // Hard-protected instruction/snapshot forms may never be shadowed.
  for (const seq of shadowedSeqs) {
    const event = session.events[seq]
    if (
      event?.type === 'user/message' &&
      hardProtectedForm((event.data.source as { form?: unknown }).form)
    ) {
      return {
        ok: false,
        errors: [
          `range ${entry.startRef}..${entry.endRef} contains a hard-protected instruction/snapshot node`,
        ],
      }
    }
  }

  // Nested blocks: active DCP checkpoints inside the range are consumed and
  // their summaries carried forward verbatim.
  const consumedBlocks = state.blocks.filter(
    (block) => block.membership === 'active' && shadowedSeqs.includes(block.seq),
  )
  const consumedBlockRefs = consumedBlocks.map((block) => block.ref)
  const priorBlocks: PriorBlock[] = consumedBlocks.map((block) => {
    const event = session.events[block.seq]
    const text =
      event?.type === 'user/message'
        ? event.data.content
            .filter((content) => content.type === 'text')
            .map((content) => (content.type === 'text' ? content.text : ''))
            .join('\n')
        : ''
    return { ref: block.ref, text }
  })

  const tokensIn = shadowedSeqs.reduce((sum, seq) => {
    const message = deriveEventMessage(events[seq]!)
    return sum + (message ? tokenMeter.estimateMessage(message) : 0)
  }, 0)

  const appendix = collectProtectedAppendix(session, shadowedSeqs, config, priorBlocks)
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
      consumedBlockRefs,
      blockRef,
    },
  }
}

export type PrepareBatchResult =
  { ok: true; prepared: PreparedRange[] } | { ok: false; errors: string[] }

/** Prepare all ranges in surface order, reject overlaps, allocate block refs. */
export function prepareBatch(
  session: Session,
  tokenMeter: TokenMeter,
  config: DcpConfig,
  state: DcpReplayState,
  args: { topic: string; content: CompressRangeEntry[] },
  firstBlockNumber: number,
): PrepareBatchResult {
  if (args.content.length === 0) return { ok: false, errors: ['content must not be empty'] }
  if (args.content.length > config.compress.maxRangesPerCall) {
    return {
      ok: false,
      errors: [`content accepts at most ${config.compress.maxRangesPerCall} range(s)`],
    }
  }

  const resolved: Array<{
    entry: CompressRangeEntry
    startPosition: number
    endPosition: number
  }> = []
  for (const entry of args.content) {
    const result = resolveRange(
      [...session.surface.nodes],
      state.boundaryRefs,
      entry.startRef,
      entry.endRef,
      state.aliases,
    )
    if (!result.ok) return { ok: false, errors: [result.reason] }
    resolved.push({
      entry,
      startPosition: result.startPosition,
      endPosition: result.endPosition,
    })
  }
  for (let index = 1; index < resolved.length; index++) {
    const previous = resolved[index - 1]!
    const current = resolved[index]!
    if (current.startPosition < previous.endPosition) {
      return {
        ok: false,
        errors: [
          `ranges must be in surface order and non-overlapping: ${previous.entry.startRef}..${previous.entry.endRef} overlaps ${current.entry.startRef}..${current.entry.endRef}`,
        ],
      }
    }
  }

  const prepared: PreparedRange[] = []
  for (const [index, resolvedEntry] of resolved.entries()) {
    const blockRef = `b${firstBlockNumber + index}`
    const result = prepareRange(
      session,
      tokenMeter,
      config,
      state,
      resolvedEntry.entry,
      blockRef,
      args.topic,
    )
    if (!result.ok) return { ok: false, errors: result.errors }
    prepared.push(result.prepared)
  }
  return { ok: true, prepared }
}
