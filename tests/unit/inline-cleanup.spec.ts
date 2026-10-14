import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { cleanupPendingCompressSteps } from '../../src/compress/step-cleanup.js'

function appendCompressPair(
  session: Session,
  options: { withResult?: boolean; mixed?: boolean } = {},
): { assistantSeq: ReturnType<Session['append']> } {
  const withResult = options.withResult ?? true
  const callId = ToolCallId('cleanup-call')
  const longSummary = 'long submitted summary '.repeat(200)
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'current task' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  const assistantSeq = session.append(
    'assistant/message',
    {
      turn: 1,
      step: 1,
      stream: [],
      message: createAssistantMessage({
        content: [
          {
            type: 'tool-call',
            id: callId,
            name: 'compress',
            arguments: JSON.stringify({
              topic: 'closed turns',
              content: [{ startRef: 'm0001', endRef: 'm0002', summary: longSummary }],
            }),
          },
          ...(options.mixed
            ? [
                {
                  type: 'tool-call' as const,
                  id: ToolCallId('other-call'),
                  name: 'read',
                  arguments: '{"path":"a.txt"}',
                },
              ]
            : []),
        ],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
    { surfaceOp: 'append' },
  )
  if (withResult) {
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'compress',
      arguments: '{}',
    })
    session.append(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId,
          content: [{ type: 'text', text: 'status=success; committed=b1' }],
          isError: false,
        }),
      },
      { surfaceOp: 'append' },
    )
    session.append('step/end', { turn: 1, step: 1 })
    session.append('step/start', { turn: 1, step: 2 })
    session.append(
      'assistant/message',
      {
        turn: 1,
        step: 2,
        stream: [],
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'I observed the previous tool result.' }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append' },
    )
    session.append('step/end', { turn: 1, step: 2 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  }
  return { assistantSeq }
}

describe('deferred compress-step cleanup (dsh 0.1.5)', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('replaces a completed compress call/result pair with an expected cleanup record', () => {
    const session = Session.create(SessionId('cleanup-pair'))
    appendCompressPair(session)

    const warnings = cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)
    expect(warnings).toEqual([])

    const messages = session.deriveMessages()
    const text = JSON.stringify(messages).replaceAll('\\"', '"')
    expect(text).toContain('<dcp-cleanup provenance="dsh-dcp" expected="true"')
    expect(text).toContain('callId: cleanup-call; name: compress')
    expect(text).toContain('<dcp-rejected')
    expect(text).not.toContain('long submitted summary')
    expect(
      messages.some((message) =>
        message.content.some(
          (block) => block.type === 'tool-call' && block.id === 'cleanup-call',
        ),
      ),
    ).toBe(false)
  })

  it('is idempotent after the pair has been pruned', () => {
    const session = Session.create(SessionId('cleanup-idempotent'))
    appendCompressPair(session)
    expect(cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)).toEqual([])
    const eventCount = session.snapshotEvents().length
    const surface = [...session.surface.nodes]
    expect(cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)).toEqual([])
    expect(session.snapshotEvents()).toHaveLength(eventCount)
    expect([...session.surface.nodes]).toEqual(surface)
  })

  it('waits for the tool result before pruning', () => {
    const session = Session.create(SessionId('cleanup-waits'))
    appendCompressPair(session, { withResult: false })
    const surface = [...session.surface.nodes]
    expect(cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)).toEqual([])
    expect([...session.surface.nodes]).toEqual(surface)
  })

  it('leaves mixed tool-call messages untouched', () => {
    const session = Session.create(SessionId('cleanup-mixed'))
    appendCompressPair(session, { mixed: true })
    const surface = [...session.surface.nodes]
    expect(cleanupPendingCompressSteps(session, fixture.ctx.tokenMeter)).toEqual([])
    expect([...session.surface.nodes]).toEqual(surface)
  })
})
