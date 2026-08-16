/**
 * compress pipeline: validate -> prepare batch -> commit each range ->
 * inline cleanup.
 *
 * @module dsh-dcp/compress/pipeline
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { DcpConfig } from '../config.js'
import { reduceDcpState } from '../protocol/replay.js'
import { validateCompressArgs, type CompressRangeArgs } from './schema.js'
import { prepareBatch, prepareRange } from './prepare.js'
import { commitRange, type CommitMeta } from './commit.js'
import { cleanupInlineSummary } from './inline-cleanup.js'

export interface CompressBlockResult {
  blockRef: string
  checkpointSeq: number
  compressedMessages: number
  compressedTokens: number
}

export interface FailedRange {
  startRef: string
  endRef: string
  error: string
}

export interface CompressRangeResult {
  blocks: CompressBlockResult[]
  failed: FailedRange[]
  cleanupWarning?: string
}

function findAuthorSeq(session: Session, compressCallId: string): number | undefined {
  for (const seq of session.surface.nodes) {
    const event = session.events[seq]
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
  if (errors.length > 0) throw new Error(errors.join('\n'))

  const state = reduceDcpState(session.events)
  const batch = prepareBatch(session, tokenMeter, config, state, args, state.maxBlockNumber + 1)
  if (!batch.ok) throw new Error(batch.errors.join('\n'))

  const blocks: CompressBlockResult[] = []
  const failed: FailedRange[] = []
  const blockRefsByIndex: Array<string | undefined> = Array.from(
    { length: args.content.length },
    () => undefined,
  )
  const authorSeq = findAuthorSeq(session, meta.compressCallId)
  for (const [index, entry] of args.content.entries()) {
    try {
      // Re-prepare against the CURRENT surface: earlier commits shift
      // positions, so each range is re-resolved at commit time.
      const currentState = reduceDcpState(session.events)
      const blockRef = `b${currentState.maxBlockNumber + 1}`
      const preparedResult = prepareRange(
        session,
        tokenMeter,
        config,
        currentState,
        entry,
        blockRef,
        args.topic,
      )
      if (!preparedResult.ok) throw new Error(preparedResult.errors.join('\n'))
      const prepared = preparedResult.prepared
      if (authorSeq !== undefined && prepared.shadowedSeqs.includes(authorSeq)) {
        throw new Error('range includes the current compress call; choose an earlier endRef')
      }
      const committed = commitRange(session, tokenMeter, prepared, prepared.blockRef, {
        ...meta,
        compactionId: CompactionId(`${String(meta.compactionId)}-${index}`),
      })
      blocks.push({
        blockRef: prepared.blockRef,
        checkpointSeq: committed.checkpointSeq,
        compressedMessages: prepared.shadowedSeqs.length,
        compressedTokens: prepared.tokensIn - prepared.tokensOut,
      })
      blockRefsByIndex[index] = prepared.blockRef
    } catch (error) {
      failed.push({
        startRef: entry.startRef,
        endRef: entry.endRef,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const cleanup =
    blocks.length > 0
      ? cleanupInlineSummary(session, tokenMeter, meta.compressCallId, blockRefsByIndex)
      : { cleaned: false, warning: 'no blocks committed; cleanup skipped' }

  return {
    blocks,
    failed,
    ...(cleanup.cleaned ? {} : { cleanupWarning: cleanup.warning }),
  }
}
