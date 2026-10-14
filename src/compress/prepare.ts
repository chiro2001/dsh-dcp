/**
 * Range preparation: resolve refs, validate cuts/retention, compute net
 * savings, and build the checkpoint text.
 *
 * @module dsh-dcp/compress/prepare
 */

import {
  deriveEventMessage,
  type Session,
  type SessionEvent,
  type SessionSeq,
} from '@deepseek-ai/dsh-session'
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
  /** Position in the model's original `content[]`; survives normalization. */
  originalIndex: number
  topic: string
  startSeq: SessionSeq
  endSeq: SessionSeq
  startPosition: number
  endPosition: number
  shadowedSeqs: SessionSeq[]
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
  // The model sometimes prefixes summary prose with a block ref. Reserved
  // cleanup/pointer markers are stripped defensively only when they are a
  // leading token: mentioning one in the technical body is valid information
  // and must remain intact. Schema validation rejects a reserved leading
  // marker on the normal tool path, but this builder is also used by lower
  // level recovery code. Only <dcp-message-id> carries checkpoint identity.
  let body = summary.trim().replace(/^\[b\d+\]\s*/, '')
  for (;;) {
    const stripped = body
      .replace(/^\[stored\s+in\s+b(?:\d+|n)\]\s*/i, '')
      .replace(/^<\/?dcp-inline-cleanup\b[^>]*>\s*/i, '')
    if (stripped === body) break
    body = stripped.trim()
  }
  return `[Compressed conversation section]\n${body}${protectedAppendix}\n\n<dcp-message-id>${blockRef}</dcp-message-id>`
}

interface ActiveBoundary {
  ref: string
  position: number
}

function activeBoundaryCandidates(
  state: DcpReplayState,
  surface: readonly SessionSeq[],
): ActiveBoundary[] {
  const candidates: ActiveBoundary[] = []
  const seen = new Set<string>()
  for (const boundary of state.boundaryRefs) {
    if (!boundary.active || seen.has(`${boundary.ref}:${String(boundary.seq)}`)) continue
    const position = surface.indexOf(boundary.seq)
    if (position === -1 || !/^m\d+$|^b\d+$/.test(boundary.ref)) continue
    seen.add(`${boundary.ref}:${String(boundary.seq)}`)
    candidates.push({ ref: boundary.ref, position })
  }
  // A native compaction can leave an old m ref addressable through an alias
  // even though its original marker is no longer active.
  for (const alias of state.aliases) {
    const position = surface.indexOf(alias.seq)
    if (position === -1 || !/^m\d+$|^b\d+$/.test(alias.ref)) continue
    if (candidates.some((candidate) => candidate.ref === alias.ref)) continue
    candidates.push({ ref: alias.ref, position })
  }
  return candidates.toSorted(
    (left, right) => left.position - right.position || left.ref.localeCompare(right.ref),
  )
}

/** Find the furthest boundary that can end before retained recent turns. */
function latestEligibleEndRef(
  state: DcpReplayState,
  surface: readonly SessionSeq[],
  events: readonly SessionEvent[],
  startPosition: number,
  latestTurn: number,
  retainRecentTurns: number,
): string | undefined {
  const cutoffTurn = latestTurn - retainRecentTurns
  const candidatesByPosition = new Map<number, ActiveBoundary[]>()
  for (const candidate of activeBoundaryCandidates(state, surface)) {
    const atPosition = candidatesByPosition.get(candidate.position) ?? []
    atPosition.push(candidate)
    candidatesByPosition.set(candidate.position, atPosition)
  }

  let maxTurnBefore = 0
  const eligible: ActiveBoundary[] = []
  for (let position = 0; position <= surface.length; position++) {
    if (position > startPosition && maxTurnBefore <= cutoffTurn) {
      eligible.push(...(candidatesByPosition.get(position) ?? []))
    }
    const seq = surface[position]
    if (seq !== undefined) {
      const turn = turnOfSeq(events, seq)
      if (turn !== undefined) maxTurnBefore = Math.max(maxTurnBefore, turn)
    }
  }
  return (
    eligible.findLast((candidate) => /^m\d+$/.test(candidate.ref))?.ref ?? eligible.at(-1)?.ref
  )
}

/** Find the next active boundary that can become a safe range start. */
function nextActiveBoundaryRef(
  state: DcpReplayState,
  surface: readonly SessionSeq[],
  protectedPosition: number,
  endPosition: number,
): string | undefined {
  return activeBoundaryCandidates(state, surface).find(
    (candidate) => candidate.position > protectedPosition && candidate.position < endPosition,
  )?.ref
}

export function prepareRange(
  session: Session,
  tokenMeter: TokenMeter,
  config: DcpConfig,
  state: DcpReplayState,
  entry: CompressRangeEntry,
  blockRef: string,
  topic: string,
  events: readonly SessionEvent[] = session.snapshotEvents(),
  originalIndex = 0,
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
  const turns = shadowedSeqs
    .map((seq) => turnOfSeq(events, seq))
    .filter((turn): turn is number => turn !== undefined)
  const latestTurn = Math.max(0, ...surface.map((seq) => turnOfSeq(events, seq) ?? 0))
  const maxShadowedTurn = Math.max(0, ...turns)
  if (maxShadowedTurn > latestTurn - config.compress.retainRecentTurns) {
    const eligibleEndRef = latestEligibleEndRef(
      state,
      surface,
      events,
      resolved.startPosition,
      latestTurn,
      config.compress.retainRecentTurns,
    )
    return {
      ok: false,
      errors: [
        `range ${entry.startRef}..${entry.endRef} enters the last ${config.compress.retainRecentTurns} turn(s); ${eligibleEndRef === undefined ? 'no eligible endRef remains; skip this range' : `use an endRef at or before ${eligibleEndRef}`} [latestEligibleEndRef=${eligibleEndRef ?? 'none'}]`,
      ],
    }
  }

  // System and tool-declaration updates are durable surface nodes in dsh 0.2.
  // Never summarize them into user-role content or remove their authority.
  for (const [offset, seq] of shadowedSeqs.entries()) {
    const event = session.eventAt(seq)
    if (
      event?.type === 'system/message' ||
      event?.type === 'developer/message' ||
      (event?.type === 'user/message' &&
        hardProtectedForm((event.data.source as { form?: unknown }).form))
    ) {
      const protectedPosition = resolved.startPosition + offset
      const nextBoundary = nextActiveBoundaryRef(
        state,
        surface,
        protectedPosition,
        resolved.endPosition,
      )
      return {
        ok: false,
        errors: [
          `range ${entry.startRef}..${entry.endRef} contains a hard-protected system/developer/instruction/snapshot node; ${nextBoundary === undefined ? 'skip this range; no active boundary remains after the protected node' : `retry with startRef at or after ${nextBoundary}`} [nextActiveBoundary=${nextBoundary ?? 'none'}]`,
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
    const event = session.eventAt(block.seq)
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
    const message = deriveEventMessage(session.eventAt(seq)!)
    return sum + (message ? tokenMeter.estimateMessage(message) : 0)
  }, 0)

  const appendix = collectProtectedAppendix(session, shadowedSeqs, config, priorBlocks, events)
  const checkpointText = buildCheckpointText(blockRef, entry.summary, appendix.text)
  const checkpointMessage = createUserMessage({
    content: [{ type: 'text', text: checkpointText }],
    source: { kind: 'dsh-dcp' },
  })
  const tokensOut = tokenMeter.estimateMessage(checkpointMessage)
  if (tokensIn - tokensOut < config.compress.minNetSavingsTokens) {
    const savingsGapTokens = Math.max(
      0,
      Math.ceil(config.compress.minNetSavingsTokens - (tokensIn - tokensOut)),
    )
    return {
      ok: false,
      errors: [
        `range ${entry.startRef}..${entry.endRef} saves ~${tokensIn - tokensOut} tokens, below minNetSavingsTokens=${config.compress.minNetSavingsTokens}; need ${savingsGapTokens} more token(s) [savingsGapTokens=${savingsGapTokens}]`,
      ],
    }
  }

  return {
    ok: true,
    prepared: {
      entry,
      originalIndex,
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

/**
 * Resolve and prepare all ranges in surface order, regardless of the order in
 * which the model supplied them. Overlaps are still rejected after sorting.
 * The original content index travels with each prepared range so callers can
 * commit safely in surface order and rewrite per-entry results correctly.
 */
export function prepareBatch(
  session: Session,
  tokenMeter: TokenMeter,
  config: DcpConfig,
  state: DcpReplayState,
  args: { topic: string; content: CompressRangeEntry[] },
  firstBlockNumber: number,
  events: readonly SessionEvent[] = session.snapshotEvents(),
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
    originalIndex: number
    startPosition: number
    endPosition: number
  }> = []
  for (const [originalIndex, entry] of args.content.entries()) {
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
      originalIndex,
      startPosition: result.startPosition,
      endPosition: result.endPosition,
    })
  }

  // Surface order is the safe commit order: replacing an older range keeps
  // later boundaries on the surface, while replacing a newer range first can
  // consume the start boundary of an older range. Make this an internal
  // implementation detail rather than a constraint on model output.
  const normalized = resolved.toSorted(
    (left, right) =>
      left.startPosition - right.startPosition ||
      left.endPosition - right.endPosition ||
      left.originalIndex - right.originalIndex,
  )

  for (let index = 1; index < normalized.length; index++) {
    const previous = normalized[index - 1]!
    const current = normalized[index]!
    if (current.startPosition < previous.endPosition) {
      return {
        ok: false,
        errors: [
          `ranges must be non-overlapping: ${previous.entry.startRef}..${previous.entry.endRef} overlaps ${current.entry.startRef}..${current.entry.endRef}`,
        ],
      }
    }
  }

  const prepared: PreparedRange[] = []
  for (const [index, resolvedEntry] of normalized.entries()) {
    const blockRef = `b${firstBlockNumber + index}`
    const result = prepareRange(
      session,
      tokenMeter,
      config,
      state,
      resolvedEntry.entry,
      blockRef,
      args.topic,
      events,
      resolvedEntry.originalIndex,
    )
    if (!result.ok) return { ok: false, errors: result.errors }
    prepared.push(result.prepared)
  }
  return { ok: true, prepared }
}
