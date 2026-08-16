import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { buildHistorySession } from '../contract/helpers.js'
import {
  encodeDcpCheckpointSource,
  type DcpCheckpointMetaV1,
} from '../../src/protocol/metadata.js'
import { applyDcpEvents, reduceDcpState } from '../../src/protocol/replay.js'

function meta(blockRef: `b${number}`): DcpCheckpointMetaV1 {
  return {
    v: 1,
    kind: 'summary',
    blockRef,
    mode: 'range',
    topic: 't',
    startRef: 'm0001',
    endRef: 'm0002',
    authorMessageId: 'a',
    compressCallId: 'c',
    consumedBlockRefs: [],
    protectedKinds: [],
  }
}

function serialize(state: ReturnType<typeof reduceDcpState>): string {
  return JSON.stringify({
    blocks: state.blocks,
    activeBlockRefs: state.activeBlockRefs,
    boundaryRefs: state.boundaryRefs,
    diagnostics: state.diagnostics,
    maxBlockNumber: state.maxBlockNumber,
    maxMarkerNumber: state.maxMarkerNumber,
    pruneReplacements: [...state.pruneReplacements.entries()],
  })
}

describe('dcp replay state', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('cold replay equals incremental replay', () => {
    const { session, seqs } = buildHistorySession(fixture.ctx)
    const compactionId = CompactionId('replay-1')
    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })
    session.append('compaction/start', { compactionId, turn: 3 })
    session.append('compaction/summary', {
      compactionId,
      summary: [{ type: 'text', text: 's' }],
      shadowedRange: { start: seqs.u1, end: seqs.a1 },
      shadowedSeqs: [seqs.u1, seqs.a1],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    const checkpoint = session.append(
      'user/message',
      createUserMessage({
        content: [
          {
            type: 'text',
            text: '[Compressed conversation section]\nsummary\n\n<dcp-message-id>b1</dcp-message-id>',
          },
        ],
        source: encodeDcpCheckpointSource(compactionId, meta('b1')),
      }),
      {
        surfaceOp: { op: 'replace', start: seqs.u1, end: seqs.a1 },
        sourceEventSeqs: [seqs.u1, seqs.a1],
      },
    )
    session.append('compaction/end', { compactionId, turn: 3 })
    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    const events = [...session.events]
    const prefix = events.slice(0, checkpoint.seq)
    const tail = events.slice(checkpoint.seq)
    const cold = reduceDcpState(events)
    const incremental = applyDcpEvents(reduceDcpState(prefix), tail)
    expect(serialize(incremental)).toBe(serialize(cold))
    expect(cold.blocks).toHaveLength(1)
    expect(cold.activeBlockRefs).toEqual(['b1'])
    expect(cold.maxBlockNumber).toBe(1)
  })

  it('marks native-absorbed blocks and records boundary markers', () => {
    const { session, seqs } = buildHistorySession(fixture.ctx)
    const dcpId = CompactionId('replay-2')
    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })
    session.append('compaction/start', { compactionId: dcpId, turn: 3 })
    session.append('compaction/summary', {
      compactionId: dcpId,
      summary: [{ type: 'text', text: 's' }],
      shadowedRange: { start: seqs.u1, end: seqs.a1 },
      shadowedSeqs: [seqs.u1, seqs.a1],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    const checkpoint = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'b1 summary' }],
        source: encodeDcpCheckpointSource(dcpId, meta('b1')),
      }),
      {
        surfaceOp: { op: 'replace', start: seqs.u1, end: seqs.a1 },
        sourceEventSeqs: [seqs.u1, seqs.a1],
      },
    )
    session.append('compaction/end', { compactionId: dcpId, turn: 3 })
    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    // A boundary marker message logged with the dsh-dcp plugin source.
    const marker = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: '<dcp-boundary ref="m0007" turn="3" step="1" />' }],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
      { surfaceOp: 'append' },
    )

    let state = reduceDcpState([...session.events])
    expect(state.blocks[0]?.membership).toBe('active')
    expect(state.boundaryRefs).toEqual(
      expect.arrayContaining([
        { ref: 'm0007', seq: expect.any(Number), active: true },
        { ref: 'b1', seq: checkpoint.seq, active: true },
      ]),
    )
    expect(state.maxMarkerNumber).toBe(7)

    // Native compaction absorbs the DCP checkpoint.
    session.append('turn/start', { turn: 4 })
    session.append('step/start', { turn: 4, step: 1 })
    const nativeId = CompactionId('replay-native')
    const shadowedSeqs = [...session.surface.nodes]
    session.append('compaction/start', { compactionId: nativeId, turn: 4 })
    session.append('compaction/summary', {
      compactionId: nativeId,
      summary: [{ type: 'text', text: 'native' }],
      shadowedRange: { start: checkpoint.seq, end: marker.seq },
      shadowedSeqs,
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'native' }],
        source: compactCheckpointSource(nativeId),
      }),
      {
        surfaceOp: { op: 'replace', start: checkpoint.seq, end: marker.seq },
        sourceEventSeqs: shadowedSeqs,
      },
    )
    session.append('compaction/end', { compactionId: nativeId, turn: 4 })
    session.append('step/end', { turn: 4, step: 1 })
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })

    state = reduceDcpState([...session.events])
    expect(state.blocks[0]?.membership).toBe('absorbed-native')
    expect(state.activeBlockRefs).toEqual([])
    expect(state.boundaryRefs[0]?.active).toBe(false)
  })
})
