import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import {
  encodeDcpCheckpointSource,
  type DcpCheckpointMetaV1,
} from '../../src/protocol/metadata.js'
import { computeSessionStats } from '../../src/stats/session.js'

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

describe('session stats (M6.0 native exclusion)', () => {
  it('excludes native compaction shadow prices and blocks', () => {
    const session = Session.create(SessionId('stats-native'))
    const u1 = session.append(
      'user/message',
      createUserMessage({ content: [{ type: 'text', text: 'one' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' },
    )
    const nativeId = CompactionId('native')
    session.append('compaction/start', { compactionId: nativeId, turn: null })
    session.append('compaction/summary', {
      compactionId: nativeId,
      summary: [{ type: 'text', text: 'native summary' }],
      shadowedRange: { start: u1.seq, end: u1.seq },
      shadowedSeqs: [u1.seq],
      shadowedTokenCount: 100,
      provider: 'mock',
      model: 'mock',
    })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'native summary' }],
        source: compactCheckpointSource(nativeId),
      }),
      {
        surfaceOp: { op: 'replace', start: u1.seq, end: u1.seq },
        sourceEventSeqs: [u1.seq],
      },
    )
    session.append('compaction/end', { compactionId: nativeId, turn: null })

    const u2 = session.append(
      'user/message',
      createUserMessage({ content: [{ type: 'text', text: 'two' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' },
    )
    const dcpId = CompactionId('dcp')
    session.append('compaction/start', { compactionId: dcpId, turn: null })
    session.append('compaction/summary', {
      compactionId: dcpId,
      summary: [{ type: 'text', text: 'dcp summary' }],
      shadowedRange: { start: u2.seq, end: u2.seq },
      shadowedSeqs: [u2.seq],
      shadowedTokenCount: 50,
      provider: 'mock',
      model: 'mock',
    })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'dcp summary' }],
        source: encodeDcpCheckpointSource(dcpId, meta('b1')),
      }),
      {
        surfaceOp: { op: 'replace', start: u2.seq, end: u2.seq },
        sourceEventSeqs: [u2.seq],
      },
    )
    session.append('compaction/end', { compactionId: dcpId, turn: null })

    const stats = computeSessionStats([...session.events])
    expect(stats.shadowedTokens).toBe(50)
    expect(stats.blockCount).toBe(1)
    expect(stats.historyReduction).toBe(stats.shadowedTokens - stats.checkpointTokens)
    expect(stats.activeBlockCount).toBeGreaterThanOrEqual(1)
  })
})
