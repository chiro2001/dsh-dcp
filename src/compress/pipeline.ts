/**
 * compress pipeline: validate -> prepare batch -> commit each range.
 *
 * Inline preview cleanup is deliberately deferred: dsh >= 0.1.5 forbids the
 * historical assistant/message replacement, so the completed compress call and
 * its tool result are archived as a pair by `step-cleanup.ts` only after a
 * later model response has consumed the native result.
 *
 * @module dsh-dcp/compress/pipeline
 */

import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { DcpConfig } from '../config.js'
import { reduceDcpState } from '../protocol/replay.js'
import {
  classifyCompressError,
  correctionForCompressFailure,
  validateCompressArgs,
  type CompressFailureCode,
  type CompressRangeArgs,
} from './schema.js'
import { prepareBatch, prepareRange } from './prepare.js'
import { commitRange, type CommitMeta } from './commit.js'

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
    throw new Error(batch.errors.join('\n'))
  }

  const blocks: CompressBlockResult[] = []
  const failed: FailedRange[] = []
  const authorSeq = findAuthorSeq(session, meta.compressCallId)
  // prepareBatch normalizes entries to surface order.  Commit order follows
  // the normalized order so each range is re-resolved against the current
  // surface without inventing cross-range atomicity.
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
    }
  }

  const status: CompressStatus =
    failed.length === 0 ? 'success' : blocks.length === 0 ? 'rejected' : 'partial'

  return {
    status,
    blocks,
    failed,
  }
}
