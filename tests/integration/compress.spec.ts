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
import { formatCompressResult } from '../../src/compress/result.js'
import { commitRange } from '../../src/compress/commit.js'
import { prepareRange } from '../../src/compress/prepare.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import type { CompressRangeEntry } from '../../src/compress/schema.js'

function markerMessage(ref: string, turn: number, step: number) {
  return createUserMessage({
    content: [{ type: 'text', text: buildBoundaryMarker(ref, turn, step) }],
    source: { kind: 'plugin', plugin: 'dsh-dcp' },
  })
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
          message: createAssistantMessage({
            content: [
              { type: 'text', text: `assistant ${number}` },
              { type: 'tool-call', id: callId, name: 'read', arguments: '{"path":"a.txt"}' },
            ],
            source: { provider: 'mock', model: 'mock' },
          }),
        },
        { surfaceOp: 'append', sourceEventSeqs: [] },
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
          message: createAssistantMessage({
            content: [{ type: 'text', text: `assistant ${number}` }],
            source: { provider: 'mock', model: 'mock' },
          }),
        },
        { surfaceOp: 'append', sourceEventSeqs: [] },
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
  const inlineArgs = JSON.stringify({
    topic: 'closed turns',
    content: inlineContent ?? [
      {
        startRef: 'm0001',
        endRef: 'm0004',
        summary: 'a very long inline summary that duplicates the checkpoint',
      },
    ],
  })
  session.append(
    'assistant/message',
    {
      turn: 4,
      step: 1,
      message: createAssistantMessage({
        content: [
          { type: 'text', text: 'compressing now' },
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
    { surfaceOp: 'append', sourceEventSeqs: [] },
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
    expect(result.cleanupWarning).toBeUndefined()

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

    // Inline cleanup: the author assistant message now carries an explicit DCP
    // provenance marker for b1, not a pointer-like natural-language token.
    const author = derived.find((message) =>
      message.content.some((block) => block.type === 'tool-call' && block.id === 'dcp-call'),
    )
    expect(author).toBeDefined()
    const call = author!.content.find((block) => block.type === 'tool-call')
    const parsed = JSON.parse((call as { arguments: string }).arguments) as {
      content: Array<{ summary: string }>
    }
    expect(parsed.content[0]!.summary).toBe(
      '<dcp-inline-cleanup provenance="dsh-dcp" status="committed" block-ref="b1" />',
    )

    // Regression: the checkpoint is the authoritative copy of the full summary,
    // while the DCP marker is only cleanup bookkeeping. This makes the
    // distinction explicit after the model sees its rewritten message.
    const checkpointMessages = derived.filter((message) =>
      message.content.some(
        (block) =>
          block.type === 'text' && block.text.includes('<dcp-message-id>b1</dcp-message-id>'),
      ),
    )
    const checkpointText = checkpointMessages
      .map((message) =>
        message.content
          .filter((block) => block.type === 'text')
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('\n'),
      )
      .join('\n')
    expect(checkpointText).toContain('consolidated summary')
    expect(checkpointText).not.toContain('dcp-inline-cleanup')
    expect(parsed.content[0]!.summary).not.toContain('consolidated summary')

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
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
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

    const author = session
      .deriveMessages()
      .find((message) =>
        message.content.some((block) => block.type === 'tool-call' && block.id === 'dcp-call'),
      )
    expect(author).toBeDefined()
    const call = author!.content.find((block) => block.type === 'tool-call')
    const parsed = JSON.parse((call as { arguments: string }).arguments) as {
      content: Array<{ summary: string }>
    }
    // b1 belongs to the original second entry (the older range); b2 belongs
    // to the original first entry (the newer range).
    expect(parsed.content.map((entry) => entry.summary)).toEqual([
      '<dcp-inline-cleanup provenance="dsh-dcp" status="committed" block-ref="b2" />',
      '<dcp-inline-cleanup provenance="dsh-dcp" status="committed" block-ref="b1" />',
    ])

    const derivedText = session
      .deriveMessages()
      .flatMap((message) =>
        message.content
          .filter((block) => block.type === 'text')
          .map((block) => (block.type === 'text' ? block.text : '')),
      )
      .join('\n')
    expect(derivedText).toContain('later closed turns')
    expect(derivedText).toContain('earlier closed turn')
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

      const author = session
        .deriveMessages()
        .find((message) =>
          message.content.some(
            (block) => block.type === 'tool-call' && block.id === 'dcp-call',
          ),
        )
      expect(author).toBeDefined()
      const call = author!.content.find((block) => block.type === 'tool-call')
      const parsed = JSON.parse((call as { arguments: string }).arguments) as {
        content: Array<{ summary: string }>
      }
      // The successful older range was normalized to b1, but that ref must
      // return to original content[1], not the first (failed) entry.
      expect(parsed.content.map((entry) => entry.summary)).toEqual([
        '<dcp-inline-cleanup provenance="dsh-dcp" status="rejected" code="UNKNOWN" />',
        '<dcp-inline-cleanup provenance="dsh-dcp" status="committed" block-ref="b1" />',
      ])
    } finally {
      appendSpy.mockRestore()
    }
  })

  it('keeps a committed checkpoint when inline cleanup append fails', () => {
    const session = buildMarkedSession(fixture.ctx)
    const config: DcpConfig = resolveConfig({
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    })
    const append = session.append.bind(session)
    const appendSpy = vi.spyOn(session, 'append').mockImplementation((type, data, ...opts) => {
      // Let the shadow-price event land, then fail the cleanup replacement.
      // This is the more dangerous append failure: the following tool result
      // must expire the pending claim without changing the committed block.
      if (type === 'assistant/message') throw new Error('simulated cleanup append failure')
      return Reflect.apply(append, session, [type, data, ...opts]) as ReturnType<typeof append>
    })

    try {
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
              summary: 'checkpoint must survive cleanup failure',
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
      expect(result.cleanupWarning).toContain('simulated cleanup append failure')
      const formatted = formatCompressResult(result)
      expect(formatted).toContain('status=success')
      expect(formatted).toContain('committed=b1')
      expect(formatted).not.toContain('committed=none')
      expect(reduceDcpState(session.snapshotEvents()).activeBlockRefs).toEqual(['b1'])
      const measure = fixture.ctx.tokenMeter.measure(session)
      expect(measure.surfaceTokens).toBe(
        measure.nodes.reduce((sum: number, node) => sum + node.tokens, 0),
      )
      expect(
        fixture.ctx.sessionProjections.snapshot(session).values.contextBreakdown?.messageTokens,
      ).toBe(measure.surfaceTokens)

      const call = session
        .snapshotEvents()
        .findLast((event) => event.type === 'tool/call' && event.data.callId === 'dcp-call')
      expect(call?.type).toBe('tool/call')
      if (call?.type !== 'tool/call') throw new Error('compress call missing')
      // A subsequent durable result expires the pending prune claim if the
      // replacement append failed. The checkpoint and token projection must
      // remain valid for the next request despite the failed cleanup.
      session.append(
        'tool/result',
        {
          turn: 4,
          step: 1,
          message: createToolResultMessage({
            callId: ToolCallId('dcp-call'),
            content: [{ type: 'text', text: 'compressed with cleanup warning' }],
            isError: false,
          }),
        },
        { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
      )
      session.append('step/end', { turn: 4, step: 1 })
      session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
      const postResultMeasure = fixture.ctx.tokenMeter.measure(session)
      expect(
        fixture.ctx.sessionProjections.snapshot(session).values.contextBreakdown?.messageTokens,
      ).toBe(postResultMeasure.surfaceTokens)
      const restored = Session.create(
        SessionId(session.id),
        structuredClone([...session.snapshotEvents()]),
      )
      expect(restored.deriveMessages()).toEqual(session.deriveMessages())
    } finally {
      appendSpy.mockRestore()
    }
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
