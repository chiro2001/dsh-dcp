/**
 * compress range pipeline: validate -> prepare -> commit -> inline cleanup.
 *
 * @module dsh-dcp/compress/pipeline
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import type { DcpConfig } from '../config.js'
import { reduceDcpState } from '../protocol/replay.js'
import { validateCompressArgs, type CompressRangeArgs } from './schema.js'
import { prepareRange } from './prepare.js'
import { commitRange, type CommitMeta } from './commit.js'
import { cleanupInlineSummary } from './inline-cleanup.js'

export interface CompressRangeResult {
  blockRef: string
  checkpointSeq: number
  compressedMessages: number
  compressedTokens: number
  cleanupWarning?: string
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
  if (args.content.length !== 1) {
    throw new Error('multiple ranges land in M2; send one range at a time')
  }

  const state = reduceDcpState(session.events)
  const blockNumber = state.maxBlockNumber + 1
  const blockRef = `b${blockNumber}`
  const preparedResult = prepareRange(
    session,
    tokenMeter,
    config,
    state,
    args.content[0]!,
    blockRef,
    args.topic,
  )
  if (!preparedResult.ok) throw new Error(preparedResult.errors.join('\n'))
  const prepared = preparedResult.prepared

  const committed = commitRange(session, tokenMeter, prepared, blockRef, meta)
  const cleanup = cleanupInlineSummary(session, tokenMeter, meta.compressCallId, blockRef)

  return {
    blockRef,
    checkpointSeq: committed.checkpointSeq,
    compressedMessages: prepared.shadowedSeqs.length,
    compressedTokens: prepared.tokensIn - prepared.tokensOut,
    ...(cleanup.cleaned ? {} : { cleanupWarning: cleanup.warning }),
  }
}
