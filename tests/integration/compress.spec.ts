import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Session, SessionId, type Session as SessionType } from '@deepseek-ai/dsh-session'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { resolveConfig, type DcpConfig } from '../../src/config.js'
import { buildBoundaryMarker } from '../../src/refs/marker.js'
import { executeCompressRange } from '../../src/compress/pipeline.js'
import { reduceDcpState } from '../../src/protocol/replay.js'

function markerMessage(ref: string, turn: number, step: number) {
  return createUserMessage({
    content: [{ type: 'text', text: buildBoundaryMarker(ref, turn, step) }],
    source: { kind: 'plugin', plugin: 'dsh-dcp' },
  })
}

function buildMarkedSession(ctx: ContractFixture['ctx']): SessionType {
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
      const callId = CallId(`c${number}`)
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
    content: [
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
            id: CallId('dcp-call'),
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
    callId: CallId('dcp-call'),
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

    expect(result.blockRef).toBe('b1')
    expect(result.compressedMessages).toBeGreaterThan(0)
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

    // Inline cleanup: the author assistant message now references b1 only.
    const author = derived.find((message) =>
      message.content.some((block) => block.type === 'tool-call' && block.id === 'dcp-call'),
    )
    expect(author).toBeDefined()
    const call = author!.content.find((block) => block.type === 'tool-call')
    const parsed = JSON.parse((call as { arguments: string }).arguments) as {
      content: Array<{ summary: string }>
    }
    expect(parsed.content[0]!.summary).toBe('[stored in b1]')

    // Replay state and token accounting.
    const state = reduceDcpState([...session.events])
    expect(state.blocks[0]?.membership).toBe('active')
    expect(state.activeBlockRefs).toEqual(['b1'])
    const measure = fixture.ctx.tokenMeter.measure(session)
    expect(measure.surfaceTokens).toBe(
      measure.nodes.reduce((sum: number, node) => sum + node.tokens, 0),
    )

    // Restart: reconstruction from the raw log agrees.
    const restored = Session.create(SessionId(session.id), structuredClone([...session.events]))
    expect(restored.deriveMessages()).toEqual(derived)

    // Close the turn so the log is complete.
    session.append(
      'tool/result',
      {
        turn: 4,
        step: 1,
        message: createToolResultMessage({
          callId: CallId('dcp-call'),
          content: [{ type: 'text', text: result.blockRef }],
          isError: false,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [session.seq - 1] },
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
            { startRef: 'm0001', endRef: 'm0002', summary: 'x' },
            { startRef: 'm0002', endRef: 'm0004', summary: 'y' },
          ],
        },
        meta,
      ),
    ).toThrow(/multiple ranges/)

    expect(() =>
      executeCompressRange(
        session,
        fixture.ctx.tokenMeter,
        resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1_000_000 } }),
        { topic: 't', content: [{ startRef: 'm0001', endRef: 'm0004', summary: 'x' }] },
        meta,
      ),
    ).toThrow(/minNetSavingsTokens/)
  })
})
