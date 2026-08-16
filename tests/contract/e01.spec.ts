import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionId, Session } from '@deepseek-ai/dsh-session'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  freezeMessage,
} from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from './fixture.js'
import { buildHistorySession } from './helpers.js'

describe('E-01: persistent transaction, metering, inline cleanup', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('unknown plugin event cannot be reconstructed without ignorable marker', () => {
    const { session } = buildHistorySession(fixture.ctx)
    const rawAppend = session.append as unknown as (type: string, data: unknown) => void
    // Public append cannot even write an out-of-vocabulary event.
    expect(() => rawAppend('plugin/test', { note: 'dcp would not be allowed' })).toThrow()
  })

  it('external writer can run a compaction transaction inside an open turn and reload', () => {
    const { session, seqs } = buildHistorySession(fixture.ctx)

    // Open a third turn; the DCP commit happens before step/end.
    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })

    const shadowedSeqs = [seqs.u1, seqs.a1]
    const shadowedTokenCount = fixture.ctx.tokenMeter.estimateMessage(
      session.deriveMessages()[0]!,
    )
    const compactionId = CompactionId('dcp-c1')

    session.append('compaction/start', { compactionId, turn: 3 })
    const summarySeq = session.append('compaction/summary', {
      compactionId,
      summary: [{ type: 'text', text: 'consolidated summary of turn one' }],
      shadowedRange: { start: seqs.u1, end: seqs.a1 },
      shadowedSeqs,
      shadowedTokenCount,
      provider: 'mock',
      model: 'mock',
    }).seq

    const checkpoint = createUserMessage({
      content: [{ type: 'text', text: 'consolidated summary of turn one' }],
      source: {
        ...compactCheckpointSource(compactionId),
        dcp: {
          v: 1,
          kind: 'summary',
          blockRef: 'b1',
          mode: 'range',
          topic: 'turn one',
          startRef: 'm0001',
          endRef: 'm0002',
          authorMessageId: String(seqs.a2),
          compressCallId: 'c-dcp-1',
          consumedBlockRefs: [],
          protectedKinds: [],
        },
      } as never,
    })

    const replace = session.append('user/message', checkpoint, {
      surfaceOp: { op: 'replace', start: seqs.u1, end: seqs.a1 },
      sourceEventSeqs: [seqs.u1, summarySeq, seqs.a1],
    })
    session.append('compaction/end', { compactionId, turn: 3 })

    // Finish the turn normally.
    const call = session.append('tool/call', {
      turn: 3,
      step: 1,
      callId: CallId('c2'),
      name: 'grep',
      arguments: JSON.stringify({ pattern: 'x' }),
    })
    session.append(
      'tool/result',
      {
        turn: 3,
        step: 1,
        message: createToolResultMessage({
          callId: CallId('c2'),
          content: [{ type: 'text', text: 'grep output' }],
          isError: false,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
    )
    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    // Surface now: checkpoint (replace), u2, a2, result, c2-result.
    const derived = session.deriveMessages()
    expect(
      derived.some((message: { content: Array<{ type: string; text?: string }> }) =>
        message.content.some(
          (block) => block.type === 'text' && block.text?.includes('consolidated summary'),
        ),
      ),
    ).toBe(true)
    expect(
      derived.some((message: { content: Array<{ type: string; text?: string }> }) =>
        message.content.some(
          (block) => block.type === 'text' && block.text?.includes('first user'),
        ),
      ),
    ).toBe(false)

    // Reconstruct from the raw log (restart without DCP logic).
    const restored = Session.create(SessionId(session.id), [...session.events])
    expect(restored.deriveMessages()).toEqual(derived)
    expect(restored.surface.nodes).toEqual(session.surface.nodes)
    expect(replace.seq).toBeGreaterThan(0)
  })

  it('checkpoint source metadata survives JSON round-trip', () => {
    const { session, seqs } = buildHistorySession(fixture.ctx)
    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })
    const compactionId = CompactionId('dcp-c2')
    const source = {
      ...compactCheckpointSource(compactionId),
      dcp: {
        v: 1,
        kind: 'summary',
        blockRef: 'b2',
        mode: 'range',
        topic: 'metadata round trip',
        startRef: 'm0001',
        endRef: 'm0002',
        authorMessageId: String(seqs.a2),
        compressCallId: 'c-dcp-2',
        consumedBlockRefs: [],
        protectedKinds: ['user'],
      },
    }

    session.append('compaction/start', { compactionId, turn: 3 })
    session.append('compaction/summary', {
      compactionId,
      summary: [{ type: 'text', text: 'summary' }],
      shadowedRange: { start: seqs.u1, end: seqs.a1 },
      shadowedSeqs: [seqs.u1, seqs.a1],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    const replace = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'summary' }],
        source: source as never,
      }),
      {
        surfaceOp: { op: 'replace', start: seqs.u1, end: seqs.a1 },
        sourceEventSeqs: [seqs.u1, seqs.a1],
      },
    )
    session.append('compaction/end', { compactionId, turn: 3 })
    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    const cloned = structuredClone([...session.events])
    const restored = Session.create(SessionId(session.id), cloned)
    const restoredEvent = restored.events.find((event) => event.seq === replace.seq)
    if (restoredEvent?.type !== 'user/message') throw new Error('replacement event missing')
    const restoredSource = restoredEvent.data.source as unknown as Record<string, unknown>
    expect(restoredSource.dcp).toEqual(source.dcp)
    expect(restoredSource.compactionId).toBe(compactionId)
  })

  it('token meter and projections stay consistent across replacements', () => {
    const { session, seqs } = buildHistorySession(fixture.ctx)

    const fullRecompute = () =>
      session
        .deriveMessages()
        .reduce(
          (sum: number, message) => sum + fixture.ctx.tokenMeter.estimateMessage(message),
          0,
        )
    const assertConsistent = () => {
      const measure = fixture.ctx.tokenMeter.measure(session)
      const nodeSum = measure.nodes.reduce((sum: number, node) => sum + node.tokens, 0)
      expect(measure.surfaceTokens).toBe(nodeSum)
      expect(measure.surfaceTokens).toBe(fullRecompute())
      const snapshot = fixture.ctx.sessionProjections.snapshot(session)
      const breakdown = snapshot.values.contextBreakdown
      expect(breakdown?.messageTokens).toBe(measure.surfaceTokens)
    }

    assertConsistent()

    // Usage anchor: request/header + usage chunk + assistant/message with usage.
    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock' } },
      reason: 'initial',
    })
    const usageChunk = session.append('assistant/chunk', {
      turn: 3,
      step: 1,
      chunk: { type: 'usage', usage: { inputTokens: 500, outputTokens: 20 } },
    })
    const anchorAssistant = session.append(
      'assistant/message',
      {
        turn: 3,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'usage anchor assistant' }],
          source: { provider: 'mock', model: 'mock' },
        }),
        usage: { inputTokens: 500, outputTokens: 20 },
      },
      { surfaceOp: 'append', sourceEventSeqs: [usageChunk.seq] },
    )
    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    const projectionBefore = fixture.ctx.sessionProjections.snapshot(session)
    const measureBefore = fixture.ctx.tokenMeter.measure(session)
    const projectedBefore = projectionBefore.values.contextPressure?.projectedTokens
    expect(projectedBefore).toBeDefined()
    expect(projectionBefore.values.contextPressure?.pressureTokens).toBe(500)

    const resultEvent = session.events.find((event) => event.seq === seqs.result)
    if (resultEvent?.type !== 'tool/result') throw new Error('tool result event missing')
    // A tool-result replacement is legal only inside an open turn/step.
    session.append('turn/start', { turn: 4 })
    session.append('step/start', { turn: 4, step: 1 })
    // Tool-result content-only replacement with adjacent compaction/prune.
    const originalResult = resultEvent.data.message
    const prunedMessage = freezeMessage({
      ...originalResult,
      content: [
        {
          ...originalResult.content[0],
          content: [{ type: 'text', text: '[tool output pruned]' }],
        },
      ],
    } as never)
    const prunedTokenCount = fixture.ctx.tokenMeter.estimateMessage(resultEvent.data.message)
    session.append('compaction/prune', {
      shadowedRange: { start: seqs.result, end: seqs.result },
      shadowedSeqs: [seqs.result],
      shadowedTokenCount: prunedTokenCount,
    })
    session.append(
      'tool/result',
      {
        turn: 2,
        step: 1,
        message: prunedMessage,
      },
      {
        surfaceOp: { op: 'replace', start: seqs.result, end: seqs.result },
        sourceEventSeqs: [seqs.result],
      },
    )
    session.append('step/end', { turn: 4, step: 1 })
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })

    assertConsistent()

    const measureAfter = fixture.ctx.tokenMeter.measure(session)
    const projectionAfter = fixture.ctx.sessionProjections.snapshot(session)
    const projectedAfter = projectionAfter.values.contextPressure?.projectedTokens
    expect(projectedAfter).toBeDefined()
    // Projected delta equals the heuristic surface delta (pressure unchanged).
    expect((projectedAfter ?? 0) - (projectedBefore ?? 0)).toBe(
      measureAfter.surfaceTokens - measureBefore.surfaceTokens,
    )
    expect(measureAfter.surfaceTokens).toBeLessThan(measureBefore.surfaceTokens)
    void anchorAssistant
  })

  it('inline summary can be cleaned with a same-step assistant replacement', () => {
    const { session } = buildHistorySession(fixture.ctx)

    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })

    const call = session.append('tool/call', {
      turn: 3,
      step: 1,
      callId: CallId('dcp-call'),
      name: 'compress',
      arguments: JSON.stringify({
        topic: 'demo',
        content: [
          {
            startRef: 'm0001',
            endRef: 'm0002',
            summary: 'long inline summary that duplicates',
          },
        ],
      }),
    })
    const assistant = session.append(
      'assistant/message',
      {
        turn: 3,
        step: 1,
        message: createAssistantMessage({
          content: [
            { type: 'text', text: 'I will compress the earlier turn.' },
            {
              type: 'tool-call',
              id: CallId('dcp-call'),
              name: 'compress',
              arguments: JSON.stringify({
                topic: 'demo',
                content: [
                  {
                    startRef: 'm0001',
                    endRef: 'm0002',
                    summary: 'long inline summary that duplicates',
                  },
                ],
              }),
            },
          ],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )

    // Clean the inline summary argument via a content-only assistant replacement.
    const original = assistant.data.message
    const cleaned = createAssistantMessage({
      content: [
        original.content[0]!,
        {
          type: 'tool-call',
          id: CallId('dcp-call'),
          name: 'compress',
          arguments: JSON.stringify({
            topic: 'demo',
            content: [{ startRef: 'm0001', endRef: 'm0002', summary: '[stored in b1]' }],
          }),
        },
      ],
      source: { provider: 'mock', model: 'mock' },
    })
    session.append('compaction/prune', {
      shadowedRange: { start: assistant.seq, end: assistant.seq },
      shadowedSeqs: [assistant.seq],
      shadowedTokenCount: fixture.ctx.tokenMeter.estimateMessage(original),
    })
    session.append(
      'assistant/message',
      {
        turn: 3,
        step: 1,
        message: cleaned,
      },
      {
        surfaceOp: { op: 'replace', start: assistant.seq, end: assistant.seq },
        sourceEventSeqs: [assistant.seq],
      },
    )

    const derived = session.deriveMessages()
    const assistantDerived = derived.find(
      (message: { role: string; content: Array<{ type: string }> }) =>
        message.role === 'assistant' &&
        message.content.some((block) => block.type === 'tool-call'),
    )
    expect(assistantDerived).toBeDefined()
    const toolCall = assistantDerived!.content.find(
      (block: { type: string }) => block.type === 'tool-call',
    )
    expect(toolCall?.type).toBe('tool-call')
    expect(JSON.parse((toolCall as { arguments: string }).arguments).content[0].summary).toBe(
      '[stored in b1]',
    )

    // Close the turn normally and verify reconstruction.
    session.append(
      'tool/result',
      {
        turn: 3,
        step: 1,
        message: createToolResultMessage({
          callId: CallId('dcp-call'),
          content: [{ type: 'text', text: 'Compressed 2 messages.' }],
          isError: false,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
    )
    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    const restored = Session.create(SessionId(session.id), structuredClone([...session.events]))
    expect(restored.deriveMessages()).toEqual(session.deriveMessages())
  })

  it('exact multi-node decompress is not expressible with current replace', () => {
    const { session, seqs } = buildHistorySession(fixture.ctx)
    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })
    const compactionId = CompactionId('dcp-c3')
    session.append('compaction/start', { compactionId, turn: 3 })
    session.append('compaction/summary', {
      compactionId,
      summary: [{ type: 'text', text: 'summary' }],
      shadowedRange: { start: seqs.u1, end: seqs.a1 },
      shadowedSeqs: [seqs.u1, seqs.a1],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    const checkpoint = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'summary' }],
        source: {
          ...compactCheckpointSource(compactionId),
          dcp: {
            v: 1,
            kind: 'summary',
            blockRef: 'b3',
            mode: 'range',
            topic: 't',
            startRef: 'm0001',
            endRef: 'm0002',
            authorMessageId: 'a',
            compressCallId: 'c',
            consumedBlockRefs: [],
            protectedKinds: [],
          },
        } as never,
      }),
      {
        surfaceOp: { op: 'replace', start: seqs.u1, end: seqs.a1 },
        sourceEventSeqs: [seqs.u1, seqs.a1],
      },
    )
    session.append('compaction/end', { compactionId, turn: 3 })

    const before = session.surface.nodes
    expect(before).toContain(checkpoint.seq)
    expect(before.filter((seq: number) => seq === seqs.u1 || seq === seqs.a1)).toEqual([])

    // A second full transaction still lands exactly one node; there is no API
    // to expand one node into several role/tool messages in one operation.
    const secondId = CompactionId('dcp-c4')
    session.append('compaction/start', { compactionId: secondId, turn: 3 })
    session.append('compaction/summary', {
      compactionId: secondId,
      summary: [{ type: 'text', text: 'second summary' }],
      shadowedRange: { start: checkpoint.seq, end: checkpoint.seq },
      shadowedSeqs: [checkpoint.seq],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    const again = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'second summary' }],
        source: {
          ...compactCheckpointSource(secondId),
          dcp: {
            v: 1,
            kind: 'summary',
            blockRef: 'b4',
            mode: 'range',
            topic: 't',
            startRef: 'm0001',
            endRef: 'm0002',
            authorMessageId: 'a',
            compressCallId: 'c',
            consumedBlockRefs: [],
            protectedKinds: [],
          },
        } as never,
      }),
      {
        surfaceOp: { op: 'replace', start: checkpoint.seq, end: checkpoint.seq },
        sourceEventSeqs: [checkpoint.seq],
      },
    )
    session.append('compaction/end', { compactionId: secondId, turn: 3 })
    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    const after = session.surface.nodes
    expect(after.filter((seq: number) => seq === again.seq)).toEqual([again.seq])
    expect(after.length).toBe(before.length)
  })
})
