/**
 * Synchronous commit of one range compression as a compaction transaction.
 *
 * @module dsh-dcp/compress/commit
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { classifyCompactionPrefix } from '../protocol/recovery.js'
import { encodeDcpCheckpointSource } from '../protocol/metadata.js'
import type { PreparedRange } from './prepare.js'
import type { CompactionId } from '@deepseek-ai/dsh-compaction'

export interface CommitMeta {
  compactionId: CompactionId
  compressCallId: string
  authorMessageId: string
}

export interface CommitResult {
  checkpointSeq: number
  blockRef: string
}

/** Commit one prepared range. Revalidates positions before the first append. */
export function commitRange(
  session: Session,
  _tokenMeter: TokenMeter,
  prepared: PreparedRange,
  blockRef: string,
  meta: CommitMeta,
): CommitResult {
  const surface = [...session.surface.nodes]
  const startPosition = surface.indexOf(prepared.startSeq)
  const endPosition = surface.indexOf(prepared.endSeq)
  if (startPosition === -1 || endPosition === -1) {
    throw new Error('compress range changed before commit; retry with current refs')
  }
  if (startPosition !== prepared.startPosition || endPosition !== prepared.endPosition) {
    throw new Error('compress range moved before commit; retry with current refs')
  }

  const classification = classifyCompactionPrefix(session.events)
  if (classification === 'live-orphan-start' || classification === 'recovered-unclosed') {
    throw new Error('compaction is busy: an unclosed bracket holds the session lock')
  }

  const header = session.requestHeader()
  const provider = header?.config.provider ?? 'unknown'
  const model = header?.config.model ?? 'unknown'
  const turn = session.surface.nodes.length > 0 ? latestOpenTurn(session) : null

  session.append('compaction/start', { compactionId: meta.compactionId, turn })
  const summarySeq = session.append('compaction/summary', {
    compactionId: meta.compactionId,
    summary: [{ type: 'text', text: prepared.checkpointText }],
    shadowedRange: {
      start: prepared.startSeq,
      end: prepared.shadowedSeqs.at(-1) ?? prepared.endSeq,
    },
    shadowedSeqs: prepared.shadowedSeqs,
    shadowedTokenCount: prepared.tokensIn,
    provider,
    model,
  }).seq

  const checkpoint = session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: prepared.checkpointText }],
      source: encodeDcpCheckpointSource(meta.compactionId, {
        v: 1,
        kind: 'summary',
        blockRef: blockRef as `b${number}`,
        mode: 'range',
        topic: prepared.topic,
        startRef: prepared.entry.startRef,
        endRef: prepared.entry.endRef,
        authorMessageId: meta.authorMessageId,
        compressCallId: meta.compressCallId,
        consumedBlockRefs: prepared.consumedBlockRefs,
        protectedKinds: prepared.protectedKinds,
      }),
    }),
    {
      surfaceOp: {
        op: 'replace',
        start: prepared.startSeq,
        end: prepared.shadowedSeqs.at(-1) ?? prepared.endSeq,
      },
      sourceEventSeqs: [prepared.startSeq, summarySeq, ...prepared.shadowedSeqs.slice(1)],
    },
  )
  session.append('compaction/end', { compactionId: meta.compactionId, turn })

  return { checkpointSeq: checkpoint.seq, blockRef }
}

function latestOpenTurn(session: Session): number | null {
  let turn: number | null = null
  for (const event of session.events) {
    if (event.type === 'turn/start') turn = event.data.turn
    if (event.type === 'turn/end') turn = null
  }
  return turn
}
