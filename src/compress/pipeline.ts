/**
 * compress pipeline: validate -> prepare batch -> commit each range ->
 * inline cleanup.
 *
 * @module dsh-dcp/compress/pipeline
 */

import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { DcpConfig } from '../config.js'
import { reduceDcpState } from '../protocol/replay.js'
import { decodeDcpMeta } from '../protocol/metadata.js'
import {
  classifyCompressError,
  correctionForCompressFailure,
  validateCompressArgs,
  type CompressFailureCode,
  type CompressRangeArgs,
} from './schema.js'
import { prepareBatch, prepareRange } from './prepare.js'
import { commitRange, type CommitMeta } from './commit.js'
import { cleanupInlineSummary, type InlineSummaryStatus } from './inline-cleanup.js'

export interface CompressBlockResult {
  blockRef: string
  checkpointSeq: SessionSeq
  compressedMessages: number
  compressedTokens: number
}

export interface FailedRange {
  /** Original content[] index; retained when ranges are normalized internally. */
  index?: number
  startRef: string
  endRef: string
  error: string
  code?: CompressFailureCode
  correction?: string
}

export type CompressStatus = 'success' | 'partial' | 'rejected'

export interface CompressRangeResult {
  /** Always present on results returned by executeCompressRange. */
  status?: CompressStatus
  blocks: CompressBlockResult[]
  failed: FailedRange[]
  cleanupWarning?: string
}

interface ContentEntry {
  index: number
  value: Record<string, unknown>
}

function contentEntries(args: unknown): ContentEntry[] {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return []
  const content = (args as Record<string, unknown>).content
  if (!Array.isArray(content)) return []
  return content.flatMap((entry, index) =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? [{ index, value: entry as Record<string, unknown> }]
      : [],
  )
}

function cleanupFailureWarning(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const compact = message.replace(/\s+/g, ' ').trim().slice(0, 240)
  return compact.length > 0
    ? `inline cleanup failed: ${compact}`
    : 'inline cleanup failed: unknown error'
}

function cleanupInlineSummarySafely(
  session: Session,
  tokenMeter: TokenMeter,
  compressCallId: string,
  statusesByIndex: readonly InlineSummaryStatus[],
): ReturnType<typeof cleanupInlineSummary> {
  try {
    return cleanupInlineSummary(session, tokenMeter, compressCallId, statusesByIndex)
  } catch (error) {
    return {
      cleaned: false,
      requested: statusesByIndex.length,
      rewritten: 0,
      unhandled: statusesByIndex.length,
      warning: cleanupFailureWarning(error),
    }
  }
}

/** Build rejection statuses for a call that failed before range preparation. */
export function rejectedStatusesForArgs(
  args: unknown,
  code: CompressFailureCode,
): InlineSummaryStatus[] {
  const entries = contentEntries(args)
  const content =
    args !== null && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>).content
      : undefined
  const statuses: InlineSummaryStatus[] = Array.isArray(content)
    ? Array.from({ length: content.length }, () => ({
        status: 'rejected' as const,
        code: 'INVALID_ARGS' as const,
      }))
    : []
  for (const { index, value } of entries) {
    statuses[index] =
      typeof value.summary === 'string'
        ? { status: 'rejected', code }
        : { status: 'rejected', code: 'INVALID_ARGS' }
  }
  return statuses
}

/**
 * Clean a call whose execution never reached the range pipeline (for example,
 * schema validation, guard denial, or a timeout final result).  The raw
 * assistant/tool-call events remain append-only; only the derived assistant
 * surface is replaced by compact rejected markers.
 */
export function cleanupRejectedCompressCall(
  session: Session,
  tokenMeter: TokenMeter,
  compressCallId: string,
  args: unknown,
  code: CompressFailureCode,
): ReturnType<typeof cleanupInlineSummary> {
  const statuses = rejectionStatusesWithCommittedCheckpoints(
    session,
    compressCallId,
    args,
    code,
  )
  return cleanupInlineSummarySafely(session, tokenMeter, compressCallId, statuses)
}

/**
 * A cleanup retry may run after a successful commit whose first cleanup
 * append failed. Recover those outcomes from durable checkpoint metadata so a
 * result observer cannot overwrite a real committed entry with `rejected`.
 */
function rejectionStatusesWithCommittedCheckpoints(
  session: Session,
  compressCallId: string,
  args: unknown,
  code: CompressFailureCode,
): InlineSummaryStatus[] {
  const statuses = rejectedStatusesForArgs(args, code)
  if (statuses.length === 0) return statuses
  const content =
    args !== null && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>).content
      : undefined
  if (!Array.isArray(content)) return statuses

  const authorEvent = session.surface.nodes
    .map((seq) => session.eventAt(seq))
    .find(
      (event) =>
        event?.type === 'assistant/message' &&
        event.data.message.content.some(
          (block) => block.type === 'tool-call' && block.id === compressCallId,
        ),
    )
  const currentAuthorId =
    authorEvent?.type === 'assistant/message' ? String(authorEvent.data.message.id) : undefined
  if (currentAuthorId === undefined) return statuses

  const committed = session.snapshotEvents().flatMap((event) => {
    if (event.type !== 'user/message') return []
    const decoded = decodeDcpMeta(event.data.source)
    if (
      !decoded.ok ||
      decoded.meta.kind !== 'summary' ||
      decoded.meta.compressCallId !== compressCallId ||
      decoded.meta.authorMessageId !== currentAuthorId
    ) {
      return []
    }
    return [
      {
        blockRef: decoded.meta.blockRef,
        startRef: decoded.meta.startRef,
        endRef: decoded.meta.endRef,
      },
    ]
  })
  for (const [index, entry] of content.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (typeof record.startRef !== 'string' || typeof record.endRef !== 'string') continue
    const checkpoint = committed.findLast(
      (candidate) =>
        candidate.startRef === record.startRef && candidate.endRef === record.endRef,
    )
    if (checkpoint !== undefined) {
      statuses[index] = { status: 'committed', blockRef: checkpoint.blockRef }
    }
  }
  return statuses
}

/**
 * Create the structured rejection used by the tool finalizer when execution
 * fails before `executeCompressRange` can return a normal result.
 */
export function rejectedCompressResult(
  args: unknown,
  error: unknown,
  code = classifyCompressError(error),
): CompressRangeResult {
  const entries = contentEntries(args)
  const message = error instanceof Error ? error.message : String(error)
  const failed =
    entries.length > 0
      ? entries.map(({ index, value }) => ({
          index,
          startRef: typeof value.startRef === 'string' ? value.startRef : '?',
          endRef: typeof value.endRef === 'string' ? value.endRef : '?',
          error: message,
          code,
          correction: correctionForCompressFailure(code, error),
        }))
      : [
          {
            startRef: '?',
            endRef: '?',
            error: message,
            code,
            correction: correctionForCompressFailure(code, error),
          },
        ]
  return {
    status: 'rejected',
    blocks: [],
    failed,
  }
}

function findAuthorSeq(session: Session, compressCallId: string): SessionSeq | undefined {
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq)
    if (
      event?.type === 'assistant/message' &&
      event.data.message.content.some(
        (block) => block.type === 'tool-call' && block.id === compressCallId,
      )
    ) {
      return seq
    }
  }
  return undefined
}

export function executeCompressRange(
  session: Session,
  tokenMeter: TokenMeter,
  config: DcpConfig,
  args: CompressRangeArgs,
  meta: CommitMeta,
): CompressRangeResult {
  const errors = validateCompressArgs(args, config.compress.maxRangesPerCall)
  if (errors.length > 0) {
    cleanupRejectedCompressCall(session, tokenMeter, meta.compressCallId, args, 'INVALID_ARGS')
    throw new Error(errors.join('\n'))
  }

  const events = session.snapshotEvents()
  const state = reduceDcpState(events)
  const batch = prepareBatch(
    session,
    tokenMeter,
    config,
    state,
    args,
    state.maxBlockNumber + 1,
    events,
  )
  if (!batch.ok) {
    const error = new Error(batch.errors.join('\n'))
    const code = classifyCompressError(error)
    cleanupRejectedCompressCall(session, tokenMeter, meta.compressCallId, args, code)
    throw error
  }

  const blocks: CompressBlockResult[] = []
  const failed: FailedRange[] = []
  const statusesByIndex: InlineSummaryStatus[] = Array.from(
    { length: args.content.length },
    () => ({ status: 'rejected', code: 'UNKNOWN' as const }),
  )
  const authorSeq = findAuthorSeq(session, meta.compressCallId)
  // prepareBatch normalizes entries to surface order.  Keep the original
  // content index alongside each entry so commit order and inline cleanup can
  // differ without assigning a checkpoint to the wrong model summary.
  for (const normalized of batch.prepared) {
    const { entry, originalIndex } = normalized
    try {
      // Re-prepare against the CURRENT surface: earlier commits shift
      // positions, so each range is re-resolved at commit time.
      const currentEvents = session.snapshotEvents()
      const currentState = reduceDcpState(currentEvents)
      const blockRef = `b${currentState.maxBlockNumber + 1}`
      const preparedResult = prepareRange(
        session,
        tokenMeter,
        config,
        currentState,
        entry,
        blockRef,
        args.topic,
        currentEvents,
        originalIndex,
      )
      if (!preparedResult.ok) throw new Error(preparedResult.errors.join('\n'))
      const prepared = preparedResult.prepared
      if (authorSeq !== undefined && prepared.shadowedSeqs.includes(authorSeq)) {
        throw new Error('range includes the current compress call; choose an earlier endRef')
      }
      const committed = commitRange(session, tokenMeter, prepared, prepared.blockRef, {
        ...meta,
        compactionId: CompactionId(`${String(meta.compactionId)}-${originalIndex}`),
      })
      blocks.push({
        blockRef: prepared.blockRef,
        checkpointSeq: committed.checkpointSeq,
        compressedMessages: prepared.shadowedSeqs.length,
        compressedTokens: prepared.tokensIn - prepared.tokensOut,
      })
      statusesByIndex[originalIndex] = { status: 'committed', blockRef: prepared.blockRef }
    } catch (error) {
      const code = classifyCompressError(error)
      failed.push({
        index: originalIndex,
        startRef: entry.startRef,
        endRef: entry.endRef,
        error: error instanceof Error ? error.message : String(error),
        code,
        correction: correctionForCompressFailure(code, error),
      })
      statusesByIndex[originalIndex] = { status: 'rejected', code }
    }
  }
  const cleanup = cleanupInlineSummarySafely(
    session,
    tokenMeter,
    meta.compressCallId,
    statusesByIndex,
  )

  const status: CompressStatus =
    failed.length === 0 ? 'success' : blocks.length === 0 ? 'rejected' : 'partial'

  return {
    status,
    blocks,
    failed,
    ...(cleanup.cleaned ? {} : { cleanupWarning: cleanup.warning }),
  }
}
