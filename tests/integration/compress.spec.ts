import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Session, SessionId, type Session as SessionType } from '@deepseek-ai/dsh-session'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { resolveConfig, type DcpConfig } from '../../src/config.js'
import { buildBoundaryMarker } from '../../src/refs/marker.js'
import { executeCompressRange } from '../../src/compress/pipeline.js'
import { cleanupPendingCompressSteps } from '../../src/compress/step-cleanup.js'
import { formatCompressResult } from '../../src/compress/result.js'
import { commitRange } from '../../src/compress/commit.js'
import { prepareRange } from '../../src/compress/prepare.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { computeSessionStats } from '../../src/stats/session.js'
import type { CompressRangeEntry } from '../../src/compress/schema.js'

function markerMessage(ref: string, turn: number, step: number) {
  return createUserMessage({
    content: [{ type: 'text', text: buildBoundaryMarker(ref, turn, step) }],
    source: { kind: 'dsh-dcp' },
  })
}

function appendAssistantObservation(session: SessionType, turn: number, step: number): void {
  session.append('step/start', { turn, step })
  session.append(
    'assistant/message',
    {
      turn,
      step,
      stream: [],
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'I observed the compression tool result.' }],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
    { surfaceOp: 'append' },
  )
  session.append('step/end', { turn, step })
}

function buildMarkedSession(
  ctx: ContractFixture['ctx'],
  inlineContent?: CompressRangeEntry[],
): SessionType {
  const session = ctx.sessions.create(
    SessionId(`compress-${Math.random().toString(36).slice(2)}`),
  )

  const turn = (number: number, ref: string, userText: string, withTool: boolean) => {
    session.append('turn/start', { turn: number })
    session.append('user/message', markerMessage(ref, number, 1), { surfaceOp: 'append' })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: userText }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    session.append('step/start', { turn: number, step: 1 })
    if (withTool) {
      const callId = ToolCallId(`c${number}`)
      session.append(
        'assistant/message',
        {
          turn: number,
          step: 1,
          stream: [],
          message: createAssistantMessage({
            content: [
              { type: 'text', text: `assistant ${number}` },
              { type: 'tool-call', id: callId, name: 'read', arguments: '{"path":"a.txt"}' },
            ],
            source: { provider: 'mock', model: 'mock' },
          }),
        },
        { surfaceOp: 'append' },
      )
      const call = session.append('tool/call', {
        turn: number,
        step: 1,
        callId,
        name: 'read',
        arguments: '{"path":"a.txt"}',
      })
      session.append(
        'tool/result',
        {
          turn: number,
          step: 1,
          message: createToolResultMessage({
            callId,
            content: [{ type: 'text', text: `result ${number}` }],
            isError: false,
          }),
        },
        { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
      )
    } else {
      session.append(
        'assistant/message',
        {
          turn: number,
          step: 1,
          stream: [],
          message: createAssistantMessage({
            content: [{ type: 'text', text: `assistant ${number}` }],
            source: { provider: 'mock', model: 'mock' },
          }),
        },
        { surfaceOp: 'append' },
      )
    }
    session.append('step/end', { turn: number, step: 1 })
    session.append('turn/end', { turn: number, reason: { kind: 'completed' } })
  }

  turn(1, 'm0001', 'first user message', false)
  turn(2, 'm0002', 'second user message', true)
  turn(3, 'm0003', 'third user message', false)

  // Open turn 4 with the compress call in flight.
  session.append('turn/start', { turn: 4 })
  session.append('user/message', markerMessage('m0004', 4, 1), { surfaceOp: 'append' })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'fourth user message' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append('step/start', { turn: 4, step: 1 })
  const cleanupBudgetedEntries = (
    inlineContent ?? [
      {
        startRef: 'm0001',
        endRef: 'm0004',
        summary: 'a very long inline summary that duplicates the checkpoint',
      },
    ]
  ).map((entry) => ({
    ...entry,
    // Cleanup tests need the old pair to be larger than its replacement.
    // Short-pair no-growth behavior has a dedicated regression case.
    summary:
      entry.summary.length >= 3000
        ? entry.summary
        : `${entry.summary}\n${'x'.repeat(3000 - entry.summary.length)}`,
  }))
  const inlineArgs = JSON.stringify({
    topic: 'closed turns',
    content: cleanupBudgetedEntries,
  })
  session.append(
    'assistant/message',
    {
      turn: 4,
      step: 1,
      stream: [],
      message: createAssistantMessage({
        content: [
          {
            type: 'tool-call',
            id: ToolCallId('dcp-call'),
            name: 'compress',
            arguments: inlineArgs,
          },
        ],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
    { surfaceOp: 'append' },
  )
  session.append('tool/call', {
    turn: 4,
    step: 1,
    callId: ToolCallId('dcp-call'),
    name: 'compress',
    arguments: inlineArgs,
  })

  return session
}

describe('compress range pipeline (M1)', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('compresses a half-open range and cleans the inline summary', () => {
    const session = buildMarkedSession(fixture.ctx)
    const config: DcpConfig = resolveConfig({
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    })

    const result = executeCompressRange(
      session,
      fixture.ctx.tokenMeter,
      config,
      {
        topic: 'closed turns',
        content: [
          {
            startRef: 'm0001',
            endRef: 'm0004',
            summary: 'consolidated summary of closed turns',
          },
        ],
      },
      {
        compactionId: CompactionId('dcp-test-1'),
        compressCallId: 'dcp-call',
        authorMessageId: 'author-1',
      },
    )

    expect(result.blocks[0]?.blockRef).toBe('b1')
    expect(result.blocks[0]?.compressedMessages).toBeGreaterThan(0)

    const derived = session.deriveMessages()
    expect(
      derived.some((message) =>
        message.content.some(
          (block) => block.type === 'text' && block.text.includes('consolidated summary'),
        ),
      ),
    ).toBe(true)
    expect(
      derived.some((message) =>
        message.content.some(
          (block) => block.type === 'text' && block.text.includes('first user message'),
        ),
      ),
    ).toBe(false)
    expect(
      derived.some((message) =>
        message.content.some(
          (block) => block.type === 'text' && block.text.includes('second user message'),
        ),
      ),
    ).toBe(false)
    expect(
      derived.some((message) =>
        message.content.some(
          (block) => block.type === 'text' && block.text.includes('third user message'),
        ),
      ),
    ).toBe(false)

    // Cleanup is deferred to the next pre-step. The original inline summary
    // and the compress call are still on surface immediately after commit.
    expect(JSON.stringify(derived)).toContain('a very long inline summary')
    expect(JSON.stringify(derived)).toContain('consolidated summary')

    // Replay state and token accounting.
    const state = reduceDcpState([...session.snapshotEvents()])
    expect(state.blocks[0]?.membership).toBe('active')
    expect(state.activeBlockRefs).toEqual(['b1'])
    const measure = fixture.ctx.tokenMeter.measure(session)
    expect(measure.surfaceTokens).toBe(
      measure.nodes.reduce((sum: number, node) => sum + node.tokens, 0),
    )

    // Restart: reconstruction from the raw log agrees.
    const restored = Session.create(
      SessionId(session.id),
      structuredClone([...session.snapshotEvents()]),
    )
    expect(restored.deriveMessages()).toEqual(derived)

    // Close the turn so the log is complete.
    session.append(
      'tool/result',
      {
        turn: 4,
        step: 1,
        message: createToolResultMessage({
          callId: ToolCallId('dcp-call'),
          content: [{ type: 'text', text: result.blocks[0]!.blockRef }],
          isError: false,
        }),
      },
      {
        surfaceOp: 'append',
        sourceEventSeqs: [
          session
            .snapshotEvents()
            .findLast(
              (event) =>
                event.type === 'tool/call' && event.data.callId === ToolCallId('dcp-call'),
            )!.seq,
        ],
      },
    )
    session.append('step/end', { turn: 4, step: 1 })
    appendAssistantObservation(session, 4, 2)
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })

    // The next pre-step replaces the completed call/result pair with one
    // expected cleanup record; the authoritative checkpoint is preserved.
    expect(cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)).toEqual([])
    const afterCleanup = session.deriveMessages()
    const afterCleanupText = JSON.stringify(afterCleanup)
    expect(afterCleanupText).toContain('<dcp-cleanup')
    expect(afterCleanupText).toContain('consolidated summary of closed turns')
    expect(afterCleanupText).not.toContain(
      'a very long inline summary that duplicates the checkpoint',
    )
  })

  it('rejects stale refs, reversed ranges, multiple ranges, and insufficient savings', () => {
    const session = buildMarkedSession(fixture.ctx)
    const config: DcpConfig = resolveConfig({
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    })
    const meta = {
      compactionId: CompactionId('dcp-test-2'),
      compressCallId: 'dcp-call',
      authorMessageId: 'author-2',
    }

    expect(() =>
      executeCompressRange(
        session,
        fixture.ctx.tokenMeter,
        config,
        { topic: 't', content: [{ startRef: 'm0001', endRef: 'm9999', summary: 'x' }] },
        meta,
      ),
    ).toThrow(/not an active boundary/)

    expect(() =>
      executeCompressRange(
        session,
        fixture.ctx.tokenMeter,
        config,
        { topic: 't', content: [{ startRef: 'm0003', endRef: 'm0001', summary: 'x' }] },
        meta,
      ),
    ).toThrow(/before endRef/)

    expect(() =>
      executeCompressRange(
        session,
        fixture.ctx.tokenMeter,
        config,
        {
          topic: 't',
          content: [
            { startRef: 'm0001', endRef: 'm0003', summary: 'x' },
            { startRef: 'm0002', endRef: 'm0004', summary: 'y' },
          ],
        },
        meta,
      ),
    ).toThrow(/overlaps/)

    expect(() =>
      executeCompressRange(
        session,
        fixture.ctx.tokenMeter,
        resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1_000_000 } }),
        { topic: 't', content: [{ startRef: 'm0001', endRef: 'm0004', summary: 'x' }] },
        meta,
      ),
    ).toThrow(/minNetSavingsTokens/)

    const multi = executeCompressRange(
      session,
      fixture.ctx.tokenMeter,
      config,
      {
        topic: 't',
        content: [
          { startRef: 'm0001', endRef: 'm0002', summary: 'x' },
          { startRef: 'm0002', endRef: 'm0004', summary: 'y' },
        ],
      },
      meta,
    )
    expect(multi.blocks.map((block) => block.blockRef)).toEqual(['b1', 'b2'])
    expect(multi.failed).toEqual([])
  })

  it('normalizes descending ranges while preserving original content indexes', () => {
    const content: CompressRangeEntry[] = [
      {
        startRef: 'm0002',
        endRef: 'm0004',
        summary: 'later closed turns',
      },
      {
        startRef: 'm0001',
        endRef: 'm0002',
        summary: 'earlier closed turn',
      },
    ]
    const session = buildMarkedSession(fixture.ctx, content)
    const config: DcpConfig = resolveConfig({
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    })

    const result = executeCompressRange(
      session,
      fixture.ctx.tokenMeter,
      config,
      { topic: 'closed turns', content },
      {
        compactionId: CompactionId('dcp-descending-ranges'),
        compressCallId: 'dcp-call',
        authorMessageId: 'author-descending',
      },
    )

    // Commit order is normalized to the surface order, even though the model
    // supplied the ranges from newest to oldest.
    expect(result.blocks.map((block) => block.blockRef)).toEqual(['b1', 'b2'])
    expect(result.failed).toEqual([])

    // The original refs are normalized by commit; complete the step and run
    // the deferred pair cleanup to prove the archive keeps both block refs.
    const call = session
      .snapshotEvents()
      .findLast((event) => event.type === 'tool/call' && event.data.callId === 'dcp-call')
    if (call?.type !== 'tool/call') throw new Error('compress call missing')
    session.append(
      'tool/result',
      {
        turn: 4,
        step: 1,
        message: createToolResultMessage({
          callId: ToolCallId('dcp-call'),
          content: [
            { type: 'text', text: result.blocks.map((block) => block.blockRef).join(',') },
          ],
          isError: false,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
    )
    session.append('step/end', { turn: 4, step: 1 })
    appendAssistantObservation(session, 4, 2)
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
    expect(cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)).toEqual([])
    const cleaned = JSON.stringify(session.deriveMessages())
    expect(cleaned).toContain('<dcp-cleanup')
    expect(cleaned).toContain('b1')
    expect(cleaned).toContain('b2')
    expect(cleaned).toContain('m0002..m0004')
    expect(cleaned).toContain('m0001..m0002')
  })

  it('keeps cleanup mapping when a later normalized range fails', () => {
    const content: CompressRangeEntry[] = [
      {
        startRef: 'm0002',
        endRef: 'm0004',
        summary: 'later range must remain inline after failure',
      },
      {
        startRef: 'm0001',
        endRef: 'm0002',
        summary: 'earlier range commits',
      },
    ]
    const session = buildMarkedSession(fixture.ctx, content)
    const config: DcpConfig = resolveConfig({
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    })

    const append = session.append.bind(session)
    let compactionStarts = 0
    const appendSpy = vi.spyOn(session, 'append').mockImplementation((type, data, ...opts) => {
      if (type === 'compaction/start') {
        compactionStarts += 1
        if (compactionStarts === 2) throw new Error('simulated later commit failure')
      }
      return Reflect.apply(append, session, [type, data, ...opts]) as ReturnType<typeof append>
    })

    try {
      const result = executeCompressRange(
        session,
        fixture.ctx.tokenMeter,
        config,
        { topic: 'closed turns', content },
        {
          compactionId: CompactionId('dcp-partial-normalized'),
          compressCallId: 'dcp-call',
          authorMessageId: 'author-partial-normalized',
        },
      )

      expect(result.blocks.map((block) => block.blockRef)).toEqual(['b1'])
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0]).toMatchObject({
        index: 0,
        startRef: 'm0002',
        endRef: 'm0004',
        error: 'simulated later commit failure',
      })

      expect(JSON.stringify(session.deriveMessages())).toContain(
        'later range must remain inline after failure',
      )
    } finally {
      appendSpy.mockRestore()
    }

    const call = session
      .snapshotEvents()
      .findLast((event) => event.type === 'tool/call' && event.data.callId === 'dcp-call')
    if (call?.type !== 'tool/call') throw new Error('compress call missing')
    session.append(
      'tool/result',
      {
        turn: 4,
        step: 1,
        message: createToolResultMessage({
          callId: ToolCallId('dcp-call'),
          content: [{ type: 'text', text: 'partial result' }],
          isError: false,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
    )
    session.append('step/end', { turn: 4, step: 1 })
    appendAssistantObservation(session, 4, 2)
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
    expect(cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)).toEqual([])
    const cleaned = JSON.stringify(session.deriveMessages()).replaceAll('\\"', '"')
    expect(cleaned).toContain('<dcp-cleanup')
    expect(cleaned).toContain('status="partial"')
    expect(cleaned).toContain('b1')
    expect(cleaned).toContain('<dcp-rejected')
  })

  it('keeps the committed checkpoint and defers cleanup until the next pre-step', () => {
    const session = buildMarkedSession(fixture.ctx)
    const config: DcpConfig = resolveConfig({
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    })

    const result = executeCompressRange(
      session,
      fixture.ctx.tokenMeter,
      config,
      {
        topic: 'closed turns',
        content: [
          {
            startRef: 'm0001',
            endRef: 'm0004',
            summary: 'checkpoint must survive deferred cleanup',
          },
        ],
      },
      {
        compactionId: CompactionId('dcp-cleanup-failure'),
        compressCallId: 'dcp-call',
        authorMessageId: 'author-cleanup-failure',
      },
    )

    expect(result.status).toBe('success')
    expect(result.blocks.map((block) => block.blockRef)).toEqual(['b1'])
    expect(formatCompressResult(result)).toContain('cleanup=deferred')
    expect(reduceDcpState(session.snapshotEvents()).activeBlockRefs).toEqual(['b1'])

    const call = session
      .snapshotEvents()
      .findLast((event) => event.type === 'tool/call' && event.data.callId === 'dcp-call')
    expect(call?.type).toBe('tool/call')
    if (call?.type !== 'tool/call') throw new Error('compress call missing')
    session.append(
      'tool/result',
      {
        turn: 4,
        step: 1,
        message: createToolResultMessage({
          callId: ToolCallId('dcp-call'),
          content: [{ type: 'text', text: 'compressed with deferred cleanup' }],
          isError: false,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
    )
    session.append('step/end', { turn: 4, step: 1 })
    appendAssistantObservation(session, 4, 2)
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
    const postResultMeasure = fixture.ctx.tokenMeter.measure(session)
    expect(
      fixture.ctx.sessionProjections.snapshot(session).values.contextBreakdown?.messageTokens,
    ).toBe(postResultMeasure.surfaceTokens)

    expect(cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)).toEqual([])
    expect(JSON.stringify(session.deriveMessages())).toContain('<dcp-cleanup')
    const restored = Session.create(
      SessionId(session.id),
      structuredClone([...session.snapshotEvents()]),
    )
    expect(restored.deriveMessages()).toEqual(session.deriveMessages())
  })

  it('recovers from cleanup replacement append failure without double-counting an orphan prune', () => {
    const session = buildMarkedSession(fixture.ctx, [
      {
        startRef: 'm0001',
        endRef: 'm0004',
        summary: 's'.repeat(6000),
      },
    ])
    const config: DcpConfig = resolveConfig({
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    })
    const content = [
      {
        startRef: 'm0001',
        endRef: 'm0004',
        summary: 'A concise, factual summary of the three closed turns.',
      },
    ]
    const result = executeCompressRange(
      session,
      fixture.ctx.tokenMeter,
      config,
      { topic: 'closed turns', content },
      {
        compactionId: CompactionId('cleanup-append-recovery'),
        compressCallId: 'dcp-call',
        authorMessageId: 'cleanup-append-recovery-author',
      },
    )
    expect(result.blocks.map((block) => block.blockRef)).toEqual(['b1'])
    const call = session
      .snapshotEvents()
      .findLast((event) => event.type === 'tool/call' && event.data.callId === 'dcp-call')
    if (call?.type !== 'tool/call') throw new Error('compress call missing')
    session.append(
      'tool/result',
      {
        turn: 4,
        step: 1,
        message: createToolResultMessage({
          callId: ToolCallId('dcp-call'),
          content: [{ type: 'text', text: 'status=success; committed=b1' }],
          isError: false,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
    )
    session.append('step/end', { turn: 4, step: 1 })
    appendAssistantObservation(session, 4, 2)
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })

    const pairSurfaceBefore = [...session.surface.nodes]
    const surfaceTokensBefore = fixture.ctx.tokenMeter.measure(session).surfaceTokens
    let failOnce = true
    const append = session.append.bind(session)
    const appendSpy = vi
      .spyOn(session, 'append')
      .mockImplementation((type, data, ...options) => {
        if (
          failOnce &&
          type === 'user/message' &&
          JSON.stringify(data).includes('<dcp-cleanup')
        ) {
          failOnce = false
          throw new Error('simulated cleanup user-message append failure')
        }
        return Reflect.apply(append, session, [type, data, ...options]) as ReturnType<
          typeof append
        >
      })
    let firstWarnings: string[]
    try {
      firstWarnings = cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)
    } finally {
      appendSpy.mockRestore()
    }

    expect(firstWarnings!).toEqual(['simulated cleanup user-message append failure'])
    expect([...session.surface.nodes]).toEqual(pairSurfaceBefore)
    expect(fixture.ctx.tokenMeter.measure(session).surfaceTokens).toBe(surfaceTokensBefore)
    expect(JSON.stringify(session.deriveMessages())).toContain('s'.repeat(100))
    expect(reduceDcpState(session.snapshotEvents()).activeBlockRefs).toEqual(['b1'])
    const orphanPrunes = session
      .snapshotEvents()
      .filter((event) => event.type === 'compaction/prune')
    expect(orphanPrunes.length).toBeGreaterThanOrEqual(1)

    expect(cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)).toEqual([])
    const events = [...session.snapshotEvents()]
    const cleanupText = JSON.stringify(session.deriveMessages())
    expect(cleanupText).toContain('<dcp-cleanup')
    expect(cleanupText).not.toContain('s'.repeat(100))
    expect(reduceDcpState(events).activeBlockRefs).toEqual(['b1'])

    const stats = computeSessionStats(events)
    expect(stats.pruneReplacements).toBe(1)
    expect(stats.pruneTokens).toBeGreaterThan(0)
    expect(stats.historyReduction).toBe(
      stats.shadowedTokens +
        stats.pruneTokens -
        stats.checkpointTokens +
        stats.expansionTokens -
        stats.markerTokens,
    )

    const restored = Session.create(SessionId(session.id), structuredClone(events))
    expect(restored.deriveMessages()).toEqual(session.deriveMessages())
    expect(reduceDcpState(restored.snapshotEvents()).activeBlockRefs).toEqual(['b1'])
    expect(computeSessionStats([...restored.snapshotEvents()])).toEqual(stats)
    const liveMeasure = fixture.ctx.tokenMeter.measure(session)
    const coldMeasure = fixture.ctx.tokenMeter.measure(restored)
    expect(coldMeasure.surfaceTokens).toBe(liveMeasure.surfaceTokens)
    expect(
      fixture.ctx.sessionProjections.snapshot(session).values.contextBreakdown?.messageTokens,
    ).toBe(liveMeasure.surfaceTokens)
    expect(
      fixture.ctx.sessionProjections.snapshot(restored).values.contextBreakdown?.messageTokens,
    ).toBe(coldMeasure.surfaceTokens)
  })

  it('returns busy before writing when a summary-only compaction bracket is open', () => {
    const session = buildMarkedSession(fixture.ctx)
    const config = resolveConfig({
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    })
    const events = session.snapshotEvents()
    const state = reduceDcpState(events)
    const entry = {
      startRef: 'm0001',
      endRef: 'm0004',
      summary: 'summary prepared before the competing bracket',
    }
    const preparedResult = prepareRange(
      session,
      fixture.ctx.tokenMeter,
      config,
      state,
      entry,
      'b9',
      'busy regression',
      events,
    )
    expect(preparedResult.ok).toBe(true)
    if (!preparedResult.ok) return

    const target = session.surface.nodes[0]!
    const competingId = CompactionId('busy-regression-compaction')
    session.append('compaction/start', { compactionId: competingId, turn: 4 })
    session.append('compaction/summary', {
      compactionId: competingId,
      summary: [{ type: 'text', text: 'summary without replacement' }],
      shadowedRange: { start: target, end: target },
      shadowedSeqs: [target],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    const before = session.snapshotEvents()

    expect(() =>
      commitRange(session, fixture.ctx.tokenMeter, preparedResult.prepared, 'b9', {
        compactionId: CompactionId('busy-regression-dcp'),
        compressCallId: 'dcp-call',
        authorMessageId: 'author',
      }),
    ).toThrow('compaction is busy')
    expect(session.snapshotEvents()).toHaveLength(before.length)
  })

  it('rejects a direct commit when prepared shadowed nodes differ from the current surface', () => {
    const session = buildMarkedSession(fixture.ctx)
    const config = resolveConfig({
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    })
    const events = session.snapshotEvents()
    const state = reduceDcpState(events)
    const preparedResult = prepareRange(
      session,
      fixture.ctx.tokenMeter,
      config,
      state,
      { startRef: 'm0001', endRef: 'm0004', summary: 'direct commit mismatch' },
      'b9',
      'direct commit regression',
      events,
    )
    expect(preparedResult.ok).toBe(true)
    if (!preparedResult.ok) return

    const mismatched = {
      ...preparedResult.prepared,
      shadowedSeqs: [...preparedResult.prepared.shadowedSeqs, preparedResult.prepared.endSeq],
    }
    const before = session.snapshotEvents()
    expect(() =>
      commitRange(session, fixture.ctx.tokenMeter, mismatched, 'b9', {
        compactionId: CompactionId('direct-mismatch'),
        compressCallId: 'dcp-call',
        authorMessageId: 'author',
      }),
    ).toThrow('compress range changed before commit')
    expect(session.snapshotEvents()).toHaveLength(before.length)
  })
})
