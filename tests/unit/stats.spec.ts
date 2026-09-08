import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
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

function appendAssistantCleanup(
  session: Session,
  callId: string,
  summary: string,
  shadowedTokenCount: number,
): void {
  const originalArguments = JSON.stringify({
    topic: 't',
    content: [{ startRef: 'm0001', endRef: 'm0002', summary: 'original summary' }],
  })
  const original = session.append(
    'assistant/message',
    {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [
          {
            type: 'tool-call',
            id: ToolCallId(callId),
            name: 'compress',
            arguments: originalArguments,
          },
        ],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
    { surfaceOp: 'append', sourceEventSeqs: [] },
  )
  const cleanedArguments = JSON.stringify({
    topic: 't',
    content: [{ startRef: 'm0001', endRef: 'm0002', summary }],
  })
  session.append('compaction/prune', {
    shadowedRange: { start: original.seq, end: original.seq },
    shadowedSeqs: [original.seq],
    shadowedTokenCount,
  })
  session.append(
    'assistant/message',
    {
      turn: 1,
      step: 1,
      message: {
        ...original.data.message,
        content: [
          {
            type: 'tool-call',
            id: ToolCallId(callId),
            name: 'compress',
            arguments: cleanedArguments,
          },
        ],
      },
    },
    {
      surfaceOp: { op: 'replace', start: original.seq, end: original.seq },
      sourceEventSeqs: [original.seq],
    },
  )
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

    const stats = computeSessionStats([...session.snapshotEvents()])
    expect(stats.shadowedTokens).toBe(50)
    expect(stats.blockCount).toBe(1)
    expect(stats.historyReduction).toBe(stats.shadowedTokens - stats.checkpointTokens)
    expect(stats.activeBlockCount).toBeGreaterThanOrEqual(1)
  })

  it('keeps the signed ledger equation including marker cost', () => {
    const session = Session.create(SessionId('stats-equation'))
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: '<dcp-boundary ref="m0001" turn="1" step="1" />' }],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
      { surfaceOp: 'append' },
    )
    const stats = computeSessionStats([...session.snapshotEvents()])
    expect(stats.historyReduction).toBe(
      stats.shadowedTokens +
        stats.pruneTokens -
        stats.checkpointTokens +
        stats.expansionTokens -
        stats.markerTokens,
    )
    expect(stats.markerTokens).toBeGreaterThan(0)
  })

  it('counts committed and rejected inline cleanup markers in the signed ledger', () => {
    const session = Session.create(SessionId('stats-inline-cleanup'))
    appendAssistantCleanup(
      session,
      'committed-call',
      '<dcp-inline-cleanup provenance="dsh-dcp" status="committed" block-ref="b1" />',
      100,
    )
    appendAssistantCleanup(
      session,
      'rejected-call',
      '<dcp-inline-cleanup provenance="dsh-dcp" status="rejected" code="RECENT_RANGE" />',
      80,
    )

    const stats = computeSessionStats([...session.snapshotEvents()])
    expect(stats.pruneReplacements).toBe(2)
    expect(stats.pruneTokens).toBe(180)
    expect(stats.checkpointTokens).toBeGreaterThan(0)
    expect(stats.historyReduction).toBe(
      stats.shadowedTokens +
        stats.pruneTokens -
        stats.checkpointTokens +
        stats.expansionTokens -
        stats.markerTokens,
    )
  })

  it('counts the legacy stored marker but ignores an unrelated assistant replacement', () => {
    const session = Session.create(SessionId('stats-inline-cleanup-legacy'))
    appendAssistantCleanup(session, 'legacy-call', '[stored in b9]', 70)

    const original = session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: '[duplicate ordinary assistant phrase]' }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('compaction/prune', {
      shadowedRange: { start: original.seq, end: original.seq },
      shadowedSeqs: [original.seq],
      shadowedTokenCount: 90,
    })
    session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: '[duplicate ordinary assistant phrase]' }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      {
        surfaceOp: { op: 'replace', start: original.seq, end: original.seq },
        sourceEventSeqs: [original.seq],
      },
    )

    const stats = computeSessionStats([...session.snapshotEvents()])
    expect(stats.pruneReplacements).toBe(1)
    expect(stats.pruneTokens).toBe(70)
  })
})
