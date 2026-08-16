/**
 * show / decompress / recompress: raw replacement DAG display, semantic
 * expansion, and recompression. Mutations run inside control turns.
 *
 * @module dsh-dcp/commands/recovery
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { reduceDcpState, type DcpReplayState } from '../protocol/replay.js'
import { encodeDcpCheckpointSource } from '../protocol/metadata.js'
import { openTurnOf } from '../protocol/turns.js'
import { buildCheckpointText } from '../compress/prepare.js'

export interface RecoveryResult {
  ok: boolean
  error?: string
  text?: string
}

function checkpointTextOf(session: Session, seq: number): string {
  const event = session.events[seq]
  if (event?.type !== 'user/message') return ''
  return event.data.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

function collectLeafSeqs(events: readonly SessionEvent[], seq: number): number[] {
  const event = events[seq]
  if (!event || event.type !== 'user/message' || event.surfaceOp === 'append') return [seq]
  const shadowed = (event.sourceEventSeqs ?? []).filter(
    (candidate) => events[candidate]?.type !== 'compaction/summary',
  )
  const leaves: number[] = []
  for (const candidate of shadowed) {
    const child = events[candidate]
    if (child?.type === 'user/message' && child.surfaceOp !== 'append') {
      leaves.push(...collectLeafSeqs(events, candidate))
    } else {
      leaves.push(candidate)
    }
  }
  return leaves
}

function transcriptOf(session: Session, seqs: readonly number[]): string {
  return seqs
    .map((seq) => {
      const message = deriveEventMessage(session.events[seq]!)
      if (!message) return ''
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
      return `--- leaf ${seq} (${message.role}) ---\n${text}`
    })
    .filter(Boolean)
    .join('\n\n')
}

export function renderBlockShow(
  session: Session,
  state: DcpReplayState,
  ref: string,
  raw: boolean,
): string {
  const block = state.blocks.find((candidate) => candidate.ref === ref)
  if (!block) return `Compression ${ref} does not exist.`
  const lines = [
    `Block ${ref}:`,
    `  mode:      ${block.meta.mode}`,
    `  topic:     ${block.meta.topic}`,
    `  status:    ${block.membership}`,
    `  summary:`,
    checkpointTextOf(session, block.seq),
  ]
  if (raw) {
    const leaves = collectLeafSeqs([...session.events], block.seq)
    lines.push('', `Original leaf nodes (${leaves.length}):`, transcriptOf(session, leaves))
  }
  return lines.join('\n')
}

function appendRecoveryBracket(
  session: Session,
  tokenMeter: TokenMeter,
  targetSeq: number,
  newRef: string,
  text: string,
  meta: {
    compactionId: ReturnType<typeof CompactionId>
    kind: 'expansion' | 'summary'
    blockRef: `b${number}`
    consumedBlockRefs: string[]
    recompressedFrom?: `b${number}`
    startRef: string
  },
): void {
  const turn = openTurnOf(session.events)
  if (turn === null) throw new Error('recovery mutation requires an open turn (control turn)')
  const target = session.events[targetSeq]
  const header = session.requestHeader()
  const provider = header?.config.provider ?? 'unknown'
  const model = header?.config.model ?? 'unknown'
  const shadowedTokenCount =
    target?.type === 'user/message' ? tokenMeter.estimateMessage(target.data) : 0
  const compactionId = meta.compactionId
  session.append('compaction/start', { compactionId, turn })
  session.append('compaction/summary', {
    compactionId,
    summary: [{ type: 'text', text }],
    shadowedRange: { start: targetSeq, end: targetSeq },
    shadowedSeqs: [targetSeq],
    shadowedTokenCount,
    provider,
    model,
  })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text }],
      source: encodeDcpCheckpointSource(compactionId, {
        v: 1,
        kind: meta.kind,
        blockRef: meta.blockRef,
        mode: 'range',
        topic: meta.kind === 'expansion' ? 'semantic expansion' : 'recompression',
        startRef: meta.startRef,
        endRef: meta.blockRef,
        authorMessageId: 'dcp-command',
        compressCallId: `dcp-${meta.kind}-${meta.blockRef}`,
        consumedBlockRefs: meta.consumedBlockRefs,
        protectedKinds: [],
        ...(meta.recompressedFrom === undefined
          ? {}
          : { recompressedFrom: meta.recompressedFrom }),
      }),
    }),
    {
      surfaceOp: { op: 'replace', start: targetSeq, end: targetSeq },
      sourceEventSeqs: [targetSeq],
    },
  )
  session.append('compaction/end', { compactionId, turn })
}

export function applyExpansion(
  session: Session,
  tokenMeter: TokenMeter,
  blockRef: string,
): RecoveryResult {
  const state = reduceDcpState(session.events)
  const block = state.blocks.find(
    (candidate) =>
      candidate.ref === blockRef &&
      candidate.membership === 'active' &&
      candidate.meta.kind === 'summary',
  )
  if (!block) return { ok: false, error: `${blockRef} is not an active summary block` }
  const leaves = collectLeafSeqs([...session.events], block.seq)
  const transcript = transcriptOf(session, leaves)
  const newRef = `b${state.maxBlockNumber + 1}`
  const text = `[Expanded block ${blockRef}]\n\n${transcript}`
  appendRecoveryBracket(session, tokenMeter, block.seq, newRef, text, {
    compactionId: CompactionId(`dcp-expand-${blockRef}`),
    kind: 'expansion',
    blockRef: newRef as `b${number}`,
    consumedBlockRefs: [blockRef],
    startRef: blockRef,
  })
  return { ok: true, text: `Expanded ${blockRef} into ${newRef} (quoted transcript).` }
}

export function applyRecompress(
  session: Session,
  tokenMeter: TokenMeter,
  blockRef: string,
): RecoveryResult {
  const state = reduceDcpState(session.events)
  const oldBlock = state.blocks.find((candidate) => candidate.ref === blockRef)
  const expansion = state.blocks.find(
    (candidate) =>
      candidate.meta.kind === 'expansion' &&
      candidate.meta.consumedBlockRefs.includes(blockRef) &&
      candidate.membership === 'active',
  )
  if (!oldBlock || !expansion) {
    return { ok: false, error: `${blockRef} has no active semantic expansion to recompress` }
  }
  const oldText = checkpointTextOf(session, oldBlock.seq)
  const newRef = `b${state.maxBlockNumber + 1}`
  const text = buildCheckpointText(newRef, oldText)
  appendRecoveryBracket(session, tokenMeter, expansion.seq, newRef, text, {
    compactionId: CompactionId(`dcp-recompress-${blockRef}`),
    kind: 'summary',
    blockRef: newRef as `b${number}`,
    consumedBlockRefs: [expansion.ref],
    recompressedFrom: blockRef as `b${number}`,
    startRef: blockRef,
  })
  return { ok: true, text: `Re-applied compression ${blockRef} as ${newRef}.` }
}
