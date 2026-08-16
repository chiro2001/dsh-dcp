import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from './fixture.js'
import { buildHistorySession } from './helpers.js'
import { reconcileBlockMembership } from './e03-helpers.js'
import { classifyCompactionPrefix } from '../../src/protocol/recovery.js'

function dcpSource(compactionId: string, blockRef: string, kind = 'summary') {
  return {
    ...compactCheckpointSource(CompactionId(compactionId)),
    dcp: {
      v: 1,
      kind,
      blockRef,
      mode: 'range',
      topic: 't',
      startRef: 'm0001',
      endRef: 'm0002',
      authorMessageId: 'a',
      compressCallId: 'c',
      consumedBlockRefs: [],
      protectedKinds: [],
    },
  } as never
}

describe('E-03: concurrency, crash, and native compaction state machine', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('classifies every crash point of a compaction bracket', () => {
    const { session, seqs } = buildHistorySession(fixture.ctx)
    const compactionId = CompactionId('crash-1')

    expect(classifyCompactionPrefix([...session.events])).toBe('none')

    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })
    session.append('compaction/start', { compactionId, turn: 3 })
    expect(classifyCompactionPrefix([...session.events])).toBe('live-orphan-start')

    session.append('compaction/summary', {
      compactionId,
      summary: [{ type: 'text', text: 's' }],
      shadowedRange: { start: seqs.u1, end: seqs.a1 },
      shadowedSeqs: [seqs.u1, seqs.a1],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    expect(classifyCompactionPrefix([...session.events])).toBe('summary-without-replace')

    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'summary' }],
        source: dcpSource('crash-1', 'b1'),
      }),
      {
        surfaceOp: { op: 'replace', start: seqs.u1, end: seqs.a1 },
        sourceEventSeqs: [seqs.u1, seqs.a1],
      },
    )
    expect(classifyCompactionPrefix([...session.events])).toBe('recovered-unclosed')

    session.append('compaction/end', { compactionId, turn: 3 })
    expect(classifyCompactionPrefix([...session.events])).toBe('committed')

    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    // failed-attempt: error end without replace
    session.append('turn/start', { turn: 4 })
    session.append('step/start', { turn: 4, step: 1 })
    const failedId = CompactionId('crash-2')
    session.append('compaction/start', { compactionId: failedId, turn: 4 })
    session.append('compaction/summary', {
      compactionId: failedId,
      summary: [{ type: 'text', text: 's' }],
      shadowedRange: { start: seqs.u1, end: seqs.a1 },
      shadowedSeqs: [seqs.u1, seqs.a1],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    session.append('compaction/end', { compactionId: failedId, turn: 4, error: 'boom' })
    expect(classifyCompactionPrefix([...session.events])).toBe('failed-attempt')
  })

  it('an orphan start before session/end-seed is stale, after it is live', () => {
    const { session } = buildHistorySession(fixture.ctx)

    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })
    session.append('compaction/start', { compactionId: CompactionId('orphan-1'), turn: 3 })
    expect(classifyCompactionPrefix([...session.events])).toBe('live-orphan-start')

    // A new lifecycle seed marks the previous orphan stale.
    session.append('session/end-seed', {})
    expect(classifyCompactionPrefix([...session.events])).toBe('stale-orphan-start')

    // A live orphan after the end-seed is live again.
    session.append('compaction/start', { compactionId: CompactionId('orphan-2'), turn: 3 })
    expect(classifyCompactionPrefix([...session.events])).toBe('live-orphan-start')

    // Forking at a boundary before the orphan yields a child with no bracket.
    const turnOneEnd = session.events.find(
      (event) => event.type === 'turn/end' && event.data.turn === 1,
    )
    if (!turnOneEnd) throw new Error('turn one end missing')
    const child = fixture.ctx.sessions.fork(session, turnOneEnd.seq)
    expect(classifyCompactionPrefix([...child.events])).toBe('none')
  })

  it('cold replay and incremental surface agree after nested replacements', () => {
    const { session, seqs } = buildHistorySession(fixture.ctx)

    const compactionId = CompactionId('nested-1')
    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })
    session.append('compaction/start', { compactionId, turn: 3 })
    session.append('compaction/summary', {
      compactionId,
      summary: [{ type: 'text', text: 's1' }],
      shadowedRange: { start: seqs.u1, end: seqs.a1 },
      shadowedSeqs: [seqs.u1, seqs.a1],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    const b1 = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'summary b1' }],
        source: dcpSource('nested-1', 'b1'),
      }),
      {
        surfaceOp: { op: 'replace', start: seqs.u1, end: seqs.a1 },
        sourceEventSeqs: [seqs.u1, seqs.a1],
      },
    )
    session.append('compaction/end', { compactionId, turn: 3 })

    // Native compaction absorbs b1 and the remainder of the visible surface.
    const nativeId = CompactionId('native-1')
    const nativeEnd = session.surface.nodes.at(-1)!
    session.append('compaction/start', { compactionId: nativeId, turn: 3 })
    session.append('compaction/summary', {
      compactionId: nativeId,
      summary: [{ type: 'text', text: 'native summary' }],
      shadowedRange: { start: b1.seq, end: nativeEnd },
      shadowedSeqs: [...session.surface.nodes],
      shadowedTokenCount: 10,
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
        surfaceOp: { op: 'replace', start: b1.seq, end: nativeEnd },
        sourceEventSeqs: [...session.surface.nodes],
      },
    )
    session.append('compaction/end', { compactionId: nativeId, turn: 3 })
    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    expect(session.surface.nodes).toHaveLength(1)

    const membership = reconcileBlockMembership([...session.events])
    expect(membership.get('b1')).toBe('absorbed-native')
  })

  it('reports token drift-free state when native compaction shadows DCP artifacts', () => {
    const { session, seqs } = buildHistorySession(fixture.ctx)

    const compactionId = CompactionId('shadow-1')
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
    const b1 = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'b1 summary' }],
        source: dcpSource('shadow-1', 'b1'),
      }),
      {
        surfaceOp: { op: 'replace', start: seqs.u1, end: seqs.a1 },
        sourceEventSeqs: [seqs.u1, seqs.a1],
      },
    )
    session.append('compaction/end', { compactionId, turn: 3 })
    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    const measureBefore = fixture.ctx.tokenMeter.measure(session)
    const membershipBefore = reconcileBlockMembership([...session.events])
    expect(membershipBefore.get('b1')).toBe('active')

    // Native compaction in a new open turn absorbs the DCP checkpoint.
    const b1Event = session.events.find((event) => event.seq === b1.seq)
    if (b1Event?.type !== 'user/message') throw new Error('b1 missing')
    session.append('turn/start', { turn: 4 })
    session.append('step/start', { turn: 4, step: 1 })
    const nativeId = CompactionId('shadow-native')
    session.append('compaction/start', { compactionId: nativeId, turn: 4 })
    session.append('compaction/summary', {
      compactionId: nativeId,
      summary: [{ type: 'text', text: 'native' }],
      shadowedRange: { start: b1.seq, end: b1.seq },
      shadowedSeqs: [b1.seq],
      shadowedTokenCount: fixture.ctx.tokenMeter.estimateMessage(b1Event.data),
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
        surfaceOp: { op: 'replace', start: b1.seq, end: b1.seq },
        sourceEventSeqs: [b1.seq],
      },
    )
    session.append('compaction/end', { compactionId: nativeId, turn: 4 })
    session.append('step/end', { turn: 4, step: 1 })
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })

    const membershipAfter = reconcileBlockMembership([...session.events])
    expect(membershipAfter.get('b1')).toBe('absorbed-native')
    const measureAfter = fixture.ctx.tokenMeter.measure(session)
    expect(measureAfter.surfaceTokens).toBeLessThan(measureBefore.surfaceTokens)
    expect(measureAfter.surfaceTokens).toBe(
      measureAfter.nodes.reduce((sum: number, node) => sum + node.tokens, 0),
    )
  })
})
