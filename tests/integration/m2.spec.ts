import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { resolveConfig, type DcpConfig } from '../../src/config.js'
import { executeCompressRange } from '../../src/compress/pipeline.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { computeSessionStats } from '../../src/stats/session.js'
import { buildMarkedSession, closeOpenTurn, markerMessage } from './m2-builder.js'

function config(overrides: Record<string, unknown> = {}): DcpConfig {
  return resolveConfig({
    compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    ...overrides,
  })
}

describe('M2: multi-range, nesting, protection, stats', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('nests a later range over an active block and carries the prior summary', () => {
    const session = buildMarkedSession(fixture.ctx)
    executeCompressRange(
      session,
      fixture.ctx.tokenMeter,
      config(),
      {
        topic: 'first',
        content: [{ startRef: 'm0001', endRef: 'm0004', summary: 'first checkpoint summary' }],
      },
      {
        compactionId: CompactionId('m2-1'),
        compressCallId: 'dcp-call',
        authorMessageId: 'a4',
      },
    )
    closeOpenTurn(session, 4, 'dcp-call')

    // Turn 5 closed; turn 6 open with a new compress call.
    session.append('turn/start', { turn: 5 })
    session.append('user/message', markerMessage('m0005', 5, 1), { surfaceOp: 'append' })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'fifth user' }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    session.append('step/start', { turn: 5, step: 1 })
    session.append(
      'assistant/message',
      {
        turn: 5,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'assistant five' }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('step/end', { turn: 5, step: 1 })
    session.append('turn/end', { turn: 5, reason: { kind: 'completed' } })

    session.append('turn/start', { turn: 6 })
    session.append('user/message', markerMessage('m0006', 6, 1), { surfaceOp: 'append' })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'sixth user' }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    session.append('step/start', { turn: 6, step: 1 })
    session.append(
      'assistant/message',
      {
        turn: 6,
        step: 1,
        message: createAssistantMessage({
          content: [
            { type: 'text', text: 'compressing again' },
            {
              type: 'tool-call',
              id: CallId('dcp-call-2'),
              name: 'compress',
              arguments:
                '{"topic":"second","content":[{"startRef":"b1","endRef":"m0006","summary":"second checkpoint summary"}]}',
            },
          ],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('tool/call', {
      turn: 6,
      step: 1,
      callId: CallId('dcp-call-2'),
      name: 'compress',
      arguments:
        '{"topic":"second","content":[{"startRef":"b1","endRef":"m0006","summary":"second checkpoint summary"}]}',
    })

    const result = executeCompressRange(
      session,
      fixture.ctx.tokenMeter,
      config(),
      {
        topic: 'second',
        content: [{ startRef: 'b1', endRef: 'm0006', summary: 'second checkpoint summary' }],
      },
      {
        compactionId: CompactionId('m2-2'),
        compressCallId: 'dcp-call-2',
        authorMessageId: 'a6',
      },
    )
    expect(result.blocks.map((block) => block.blockRef)).toEqual(['b2'])
    expect(result.failed).toEqual([])

    const derived = session.deriveMessages()
    const text = derived
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('second checkpoint summary')
    expect(text).toContain('Included prior blocks')
    expect(text).toContain('first checkpoint summary')

    const state = reduceDcpState([...session.events])
    expect(state.blocks.find((block) => block.ref === 'b1')?.membership).toBe('consumed')
    expect(state.blocks.find((block) => block.ref === 'b2')?.membership).toBe('active')
    expect(state.maxBlockNumber).toBe(2)
  })

  it('computes session stats and appends protected tool output verbatim', () => {
    const session = buildMarkedSession(fixture.ctx)
    executeCompressRange(
      session,
      fixture.ctx.tokenMeter,
      config({
        compress: {
          retainRecentTurns: 1,
          minNetSavingsTokens: 1,
          protectedTools: ['read'],
        },
        protectedFilePatterns: ['**/*.txt'],
      }),
      {
        topic: 'protected',
        content: [{ startRef: 'm0001', endRef: 'm0004', summary: 'protected summary' }],
      },
      {
        compactionId: CompactionId('m2-3'),
        compressCallId: 'dcp-call',
        authorMessageId: 'a4',
      },
    )

    const derived = session.deriveMessages()
    const text = derived
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('Protected tool read output verbatim')
    expect(text).toContain('result 2')

    const stats = computeSessionStats([...session.events])
    expect(stats.blockCount).toBe(1)
    expect(stats.shadowedTokens).toBeGreaterThan(0)
    expect(stats.netSavedTokens).toBeGreaterThan(0)
    expect(stats.markerTokens).toBeGreaterThan(0)
  })

  it('rejects ranges containing hard-protected instruction messages', () => {
    const ctx = fixture.ctx
    const minimal = ctx.sessions.create()
    minimal.append('turn/start', { turn: 1 })
    minimal.append('user/message', markerMessage('m0001', 1, 1), { surfaceOp: 'append' })
    minimal.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'MUST NOT COMPRESS' }],
        source: { kind: 'plugin', plugin: 'test', form: 'instructions' },
      }),
      { surfaceOp: 'append' },
    )
    minimal.append('step/start', { turn: 1, step: 1 })
    minimal.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'assistant' }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    minimal.append('step/end', { turn: 1, step: 1 })
    minimal.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    minimal.append('turn/start', { turn: 2 })
    minimal.append('user/message', markerMessage('m0002', 2, 1), { surfaceOp: 'append' })
    minimal.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'second' }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    minimal.append('step/start', { turn: 2, step: 1 })
    minimal.append(
      'assistant/message',
      {
        turn: 2,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'assistant two' }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    minimal.append('step/end', { turn: 2, step: 1 })
    minimal.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    minimal.append('turn/start', { turn: 3 })
    minimal.append('user/message', markerMessage('m0003', 3, 1), { surfaceOp: 'append' })
    minimal.append('step/start', { turn: 3, step: 1 })

    expect(() =>
      executeCompressRange(
        minimal,
        fixture.ctx.tokenMeter,
        config(),
        {
          topic: 't',
          content: [{ startRef: 'm0001', endRef: 'm0003', summary: 'x' }],
        },
        {
          compactionId: CompactionId('m2-4'),
          compressCallId: 'none',
          authorMessageId: 'none',
        },
      ),
    ).toThrow(/hard-protected/)

    // Cleanup: close the open turn (no tool result needed).
    minimal.append('step/end', { turn: 3, step: 1 })
    minimal.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
  })
})
