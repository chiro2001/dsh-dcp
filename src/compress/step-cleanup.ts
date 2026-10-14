/**
 * Deferred compress-step cleanup for dsh >= 0.1.5.
 *
 * The host embeds the provider stream in every assistant message and forbids
 * `sourceEventSeqs` on assistant/message replacements.  Instead of rewriting
 * one historical assistant node in place, DCP prunes the completed compress
 * call and its tool result as one user/message replacement after a later
 * settled response proves the model has consumed the native tool outcome.  The raw log keeps the original call and summary; the derived
 * surface keeps a compact, expected cleanup record.
 *
 * @module dsh-dcp/compress/step-cleanup
 */

import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { correctionForCompressFailure, type CompressFailureCode } from './schema.js'
import { decodeDcpMeta, type DcpCheckpointMetaV1 } from '../protocol/metadata.js'

interface CompressCallRecord {
  callId: string
  argumentsText: string
  resultSeq: SessionSeq
}

interface PendingStepCleanup {
  authorSeq: SessionSeq
  spanSeqs: SessionSeq[]
  calls: CompressCallRecord[]
}

interface ParsedCallArguments {
  entries: Array<{ startRef?: string; endRef?: string; summary?: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function textOfContent(content: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
      continue
    }
  }
  return parts.filter((part) => part.length > 0).join('\n')
}

function resultTextOf(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return textOfContent(event.data.message.content).trim()
}

function parseCallArguments(argumentsText: string): ParsedCallArguments {
  try {
    const parsed: unknown = JSON.parse(argumentsText)
    if (!isRecord(parsed)) return { entries: [] }
    const entries = Array.isArray(parsed.content)
      ? parsed.content.flatMap((entry) => {
          if (!isRecord(entry)) return []
          return [
            {
              ...(typeof entry.startRef === 'string' ? { startRef: entry.startRef } : {}),
              ...(typeof entry.endRef === 'string' ? { endRef: entry.endRef } : {}),
              ...(typeof entry.summary === 'string' ? { summary: entry.summary } : {}),
            },
          ]
        })
      : []
    return {
      entries,
    }
  } catch {
    return { entries: [] }
  }
}

/** Locate a closed compress pair that a later closed model response has observed. */
function findPendingStepCleanup(
  session: Session,
  skipped: Set<SessionSeq>,
): PendingStepCleanup | undefined {
  const surface = session.surface.nodes
  const events = session.snapshotEvents()
  const closedSteps = new Map<string, SessionSeq>()
  for (const event of events) {
    if (event.type === 'step/end')
      closedSteps.set(`${event.data.turn}:${event.data.step}`, event.seq)
  }
  const observedThrough =
    events.findLast(
      (event) =>
        event.type === 'assistant/message' &&
        (closedSteps.get(`${event.data.turn}:${event.data.step}`) ?? -1) > event.seq,
    )?.seq ?? -1
  for (let position = 0; position < surface.length; position++) {
    const authorSeq = surface[position]!
    const authorEvent = session.eventAt(authorSeq)
    if (authorEvent?.type !== 'assistant/message' || skipped.has(authorSeq)) continue
    if (authorEvent.data.message.content.some((block) => block.type !== 'tool-call')) continue

    const toolCalls = authorEvent.data.message.content.filter(
      (block) => block.type === 'tool-call',
    )
    if (toolCalls.length === 0) continue
    if (!toolCalls.every((block) => block.name === 'compress')) continue
    const endSeq = closedSteps.get(`${authorEvent.data.turn}:${authorEvent.data.step}`)
    if (endSeq === undefined || endSeq <= authorSeq) continue

    const resultByCallId = new Map<string, SessionSeq>()
    for (let index = 0; index < surface.length; index++) {
      const seq = surface[index]!
      const event = session.eventAt(seq)
      if (
        event?.type !== 'tool/result' ||
        seq >= endSeq ||
        event.data.turn !== authorEvent.data.turn ||
        event.data.step !== authorEvent.data.step
      )
        continue
      const callId = String(event.data.message.source.callId)
      if (toolCalls.some((block) => String(block.id) === callId)) {
        resultByCallId.set(callId, seq)
      }
    }
    if (resultByCallId.size !== toolCalls.length) continue

    const resultSeqs = [...resultByCallId.values()]
    // Preserve native execution evidence for the first request following the
    // result. A later settled response proves the model consumed that outcome.
    if (resultSeqs.some((seq) => seq >= observedThrough)) continue
    const positions = [position, ...resultSeqs.map((seq) => surface.indexOf(seq))]
    if (positions.some((entry) => entry < 0)) continue
    positions.sort((left, right) => left - right)
    const startPosition = positions[0]!
    const endPosition = positions.at(-1)!
    if (startPosition !== position) continue

    const expectedSeqs = new Set<SessionSeq>([authorSeq, ...resultSeqs])
    const spanSeqs = surface.slice(startPosition, endPosition + 1)
    // Fail closed when an unrelated node is interleaved in the candidate span.
    if (spanSeqs.some((seq) => !expectedSeqs.has(seq))) continue

    const calls = toolCalls.map((block) => ({
      callId: String(block.id),
      argumentsText: block.arguments,
      resultSeq: resultByCallId.get(String(block.id))!,
    }))
    return { authorSeq, spanSeqs, calls }
  }
  return undefined
}

function committedCheckpoints(events: readonly SessionEvent[]): Array<{
  meta: DcpCheckpointMetaV1
  text: string
  seq: SessionSeq
}> {
  const records: Array<{ meta: DcpCheckpointMetaV1; text: string; seq: SessionSeq }> = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const decoded = decodeDcpMeta(event.data.source)
    if (!decoded.ok || decoded.meta.kind !== 'summary') continue
    records.push({
      meta: decoded.meta,
      text: textOfContent(event.data.content),
      seq: event.seq,
    })
  }
  return records
}

const FAILURE_CODES = new Set<CompressFailureCode>([
  'INVALID_ARGS',
  'STALE_REF',
  'RANGE_ORDER',
  'EMPTY_RANGE',
  'UNBALANCED_TOOL_RANGE',
  'RECENT_RANGE',
  'PROTECTED_RANGE',
  'INSUFFICIENT_SAVINGS',
  'BUSY',
  'CURRENT_CALL',
  'RANGE_CHANGED',
  'ABORTED',
  'TIMEOUT',
  'DENIED',
  'UNKNOWN',
])

function safeRef(value: string | undefined): string {
  return value !== undefined && /^[mb]\d{1,16}$/.test(value) ? value : '?'
}

function buildCleanupText(
  session: Session,
  candidate: PendingStepCleanup,
  checkpoints: ReturnType<typeof committedCheckpoints>,
): string {
  let committed = 0
  let rejected = 0
  const committedRefs: string[] = []
  const rejectedRefs: string[] = []
  const lines: string[] = []
  for (const call of candidate.calls) {
    const id = /^[\w.-]{1,128}$/.test(call.callId) ? call.callId : '<unavailable>'
    lines.push(`callId: ${id}; name: compress`)
    const parsed = parseCallArguments(call.argumentsText)
    const result = session.eventAt(call.resultSeq)
    const resultText = result?.type === 'tool/result' ? resultTextOf(result) : ''
    const entries = parsed.entries.length > 0 ? parsed.entries : [{}]
    for (const entry of entries.slice(0, 8)) {
      const match = checkpoints.findLast(
        (record) =>
          record.meta.compressCallId === call.callId &&
          record.meta.startRef === entry.startRef &&
          record.meta.endRef === entry.endRef,
      )
      const refs = `${safeRef(entry.startRef)}..${safeRef(entry.endRef)}`
      if (match !== undefined) {
        committed++
        committedRefs.push(match.meta.blockRef)
        lines.push(
          `${refs}: <dcp-archived in ${match.meta.blockRef}; submitted_chars=${entry.summary?.length ?? 0}; stored_chars=${match.text.length}; verbatim=true>`,
        )
      } else {
        rejected++
        const rangeOutcome = resultText
          .split(/[,;]/)
          .find((part) => part.trim().startsWith(refs + '['))
        const rawCode = /\[([A-Z][A-Z0-9_]*)\]/.exec(rangeOutcome ?? resultText)?.[1] as
          CompressFailureCode | undefined
        const code = rawCode !== undefined && FAILURE_CODES.has(rawCode) ? rawCode : 'UNKNOWN'
        const resolved = checkpoints.findLast(
          (record) =>
            record.seq > call.resultSeq &&
            record.meta.compressCallId !== call.callId &&
            record.meta.startRef === entry.startRef &&
            record.meta.endRef === entry.endRef,
        )
        if (resolved !== undefined) {
          // Preserve the original failure identity without directing a retry
          // of history that a later call has already committed.
          lines.push(
            `${refs}: <dcp-rejected; code=${code}; resolved_by=${resolved.meta.blockRef}>`,
          )
        } else {
          rejectedRefs.push(`${refs}[${code}]`)
          lines.push(`${refs}: <dcp-rejected; code=${code}; body_removed=true>`)
          lines.push(`correction=${correctionForCompressFailure(code)}`)
        }
      }
    }
    if (entries.length > 8)
      lines.push('Additional rejected entries omitted; inspect the raw log.')
  }
  const status = committed === 0 ? 'rejected' : rejected === 0 ? 'success' : 'partial'
  const correction =
    rejectedRefs.length === 0 ? 'STOP' : 'HANDLE ONLY the rejected ranges as directed'
  return [
    `<dcp-cleanup provenance="dsh-dcp" expected="true" status="${status}">`,
    ...lines,
    `archived_result: status=${status}; committed=${committedRefs.join(',') || 'none'}; rejected=${rejectedRefs.join(',') || 'none'}; correction=${correction}`,
    'Summaries are in checkpoints; raw calls remain logged. Continue the task; do not retry committed ranges.',
    '</dcp-cleanup>',
  ].join('\n')
}

function messageTokens(
  session: Session,
  tokenMeter: Pick<TokenMeter, 'estimateMessage'>,
  seq: SessionSeq,
): number {
  const event = session.eventAt(seq)
  if (event === undefined) return 0
  const message = session.deriveEventMessage(event)
  return message === null ? 0 : tokenMeter.estimateMessage(message)
}

function applyStepCleanup(
  session: Session,
  tokenMeter: Pick<TokenMeter, 'estimateMessage'>,
  candidate: PendingStepCleanup,
): boolean {
  const events = session.snapshotEvents()
  const checkpoints = committedCheckpoints(events)
  const text = buildCleanupText(session, candidate, checkpoints)
  const firstSeq = candidate.spanSeqs[0]!
  const lastSeq = candidate.spanSeqs.at(-1)!
  const shadowedTokenCount = candidate.spanSeqs.reduce(
    (sum, seq) => sum + messageTokens(session, tokenMeter, seq),
    0,
  )
  const cleanupMessage = createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'dsh-dcp' },
  })
  if (tokenMeter.estimateMessage(cleanupMessage) >= shadowedTokenCount) return false
  session.append('compaction/prune', {
    shadowedRange: { start: firstSeq, end: lastSeq },
    shadowedSeqs: [...candidate.spanSeqs],
    shadowedTokenCount,
  })
  session.append('user/message', cleanupMessage, {
    surfaceOp: { op: 'replace', startSeq: firstSeq, endSeq: lastSeq },
    sourceEventSeqs: [...candidate.spanSeqs],
  })
  return true
}

/**
 * Archive observed, completed compress call/result pairs in a compact cleanup
 * record.  Safe to call at each pre-step: already replaced pairs no longer
 * expose a compress tool call on the current surface.
 *
 * @returns warnings for candidates that could not be cleaned.
 */
export function cleanupPendingCompressSteps(
  session: Session,
  tokenMeter: Pick<TokenMeter, 'estimateMessage'>,
  maxIterations = 8,
): string[] {
  const warnings: string[] = []
  const skipped = new Set<SessionSeq>()
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const candidate = findPendingStepCleanup(session, skipped)
    if (candidate === undefined) break
    try {
      if (!applyStepCleanup(session, tokenMeter, candidate)) skipped.add(candidate.authorSeq)
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error))
      break
    }
  }
  return warnings
}
