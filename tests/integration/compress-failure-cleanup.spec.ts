import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { resolveConfig } from '../../src/config.js'
import { buildBoundaryMarker } from '../../src/refs/marker.js'
import { executeCompressRange } from '../../src/compress/pipeline.js'
import type { CompressRangeEntry } from '../../src/compress/schema.js'

describe('failed compress inline cleanup', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('removes a 4121-character rejected summary before a later retry', () => {
    const session = fixture.ctx.sessions.create(SessionId('failed-summary-cleanup'))
    const longSummary = 'x'.repeat(4121)

    const appendTurn = (turn: number, ref: string, text: string) => {
      session.append('turn/start', { turn })
      session.append(
        'user/message',
        createUserMessage({
          content: [{ type: 'text', text: buildBoundaryMarker(ref, turn, 1) }],
          source: { kind: 'plugin', plugin: 'dsh-dcp' },
        }),
        { surfaceOp: 'append' },
      )
      session.append(
        'user/message',
        createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
        { surfaceOp: 'append' },
      )
      session.append('step/start', { turn, step: 1 })
    }

    const appendCall = (callId: string, args: string, turn: number) => {
      session.append(
        'assistant/message',
        {
          turn,
          step: 1,
          message: createAssistantMessage({
            content: [
              { type: 'tool-call', id: ToolCallId(callId), name: 'compress', arguments: args },
            ],
            source: { provider: 'mock', model: 'mock' },
          }),
        },
        { surfaceOp: 'append', sourceEventSeqs: [] },
      )
      return session.append('tool/call', {
        turn,
        step: 1,
        callId: ToolCallId(callId),
        name: 'compress',
        arguments: args,
      })
    }

    appendTurn(1, 'm0001', 'old context one')
    session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'old answer one' }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    appendTurn(2, 'm0002', 'old context two')
    session.append(
      'assistant/message',
      {
        turn: 2,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'old answer two' }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('step/end', { turn: 2, step: 1 })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    appendTurn(3, 'm0003', 'old context three')
    session.append(
      'assistant/message',
      {
        turn: 3,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'old answer three' }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('step/end', { turn: 3, step: 1 })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    appendTurn(4, 'm0004', 'current context')
    const failedArgs = JSON.stringify({
      topic: 'old context',
      content: [
        {
          startRef: 'm0001',
          endRef: 'm0004',
          summary: longSummary,
        } satisfies CompressRangeEntry,
      ],
    })
    const failedCall = appendCall('failed-call', failedArgs, 4)

    expect(() =>
      executeCompressRange(
        session,
        fixture.ctx.tokenMeter,
        resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1_000_000 } }),
        JSON.parse(failedArgs) as { topic: string; content: CompressRangeEntry[] },
        {
          compactionId: CompactionId('failed-summary'),
          compressCallId: 'failed-call',
          authorMessageId: 'failed-author',
        },
      ),
    ).toThrow(/minNetSavingsTokens/)

    const failedSurfaceText = JSON.stringify(session.deriveMessages())
    expect(failedSurfaceText).not.toContain(longSummary)
    const failedAuthor = session
      .deriveMessages()
      .find((message) =>
        message.content.some(
          (block) => block.type === 'tool-call' && block.id === 'failed-call',
        ),
      )
    const failedToolCall = failedAuthor?.content.find(
      (block) => block.type === 'tool-call' && block.id === 'failed-call',
    )
    expect(failedToolCall?.type).toBe('tool-call')
    expect(
      JSON.parse((failedToolCall as { arguments: string }).arguments).content[0].summary,
    ).toBe(
      '<dcp-inline-cleanup provenance="dsh-dcp" status="rejected" code="INSUFFICIENT_SAVINGS" />',
    )

    const rawAfterFailure = session.snapshotEvents()
    expect(
      rawAfterFailure.some(
        (event) =>
          event.type === 'assistant/message' &&
          event.data.message.content.some(
            (block) => block.type === 'tool-call' && block.arguments.includes(longSummary),
          ),
      ),
    ).toBe(true)

    // Close the failed model call, then submit a fresh retry in the next turn.
    session.append(
      'tool/result',
      {
        turn: 4,
        step: 1,
        message: createToolResultMessage({
          callId: ToolCallId('failed-call'),
          content: [{ type: 'text', text: 'rejected' }],
          isError: true,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [failedCall.seq] },
    )
    session.append('step/end', { turn: 4, step: 1 })
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })

    appendTurn(5, 'm0005', 'retry compression')
    const retryArgs = JSON.stringify({
      topic: 'old context',
      content: [
        { startRef: 'm0001', endRef: 'm0004', summary: 'short successful retry summary' },
      ],
    })
    appendCall('retry-call', retryArgs, 5)
    const retry = executeCompressRange(
      session,
      fixture.ctx.tokenMeter,
      resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 } }),
      JSON.parse(retryArgs) as { topic: string; content: CompressRangeEntry[] },
      {
        compactionId: CompactionId('successful-retry'),
        compressCallId: 'retry-call',
        authorMessageId: 'retry-author',
      },
    )
    expect(retry.status).toBe('success')

    const derivedText = session
      .deriveMessages()
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(derivedText).not.toContain(longSummary)
    expect(derivedText).not.toContain('rejected')
    expect(derivedText).toContain('short successful retry summary')

    const measure = fixture.ctx.tokenMeter.measure(session)
    expect(measure.surfaceTokens).toBe(
      measure.nodes.reduce((sum: number, node) => sum + node.tokens, 0),
    )
    expect(
      fixture.ctx.sessionProjections.snapshot(session).values.contextBreakdown?.messageTokens,
    ).toBe(measure.surfaceTokens)

    const restored = Session.create(
      SessionId(session.id),
      structuredClone([...session.snapshotEvents()]),
    )
    expect(restored.deriveMessages()).toEqual(session.deriveMessages())
  })
})
