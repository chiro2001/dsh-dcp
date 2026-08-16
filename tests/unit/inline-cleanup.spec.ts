import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { cleanupInlineSummary } from '../../src/compress/inline-cleanup.js'

describe('inline cleanup indexed mapping (M6.0)', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('rewrites only entries with a committed block ref', () => {
    const session = Session.create(SessionId('cleanup-index'))
    session.append('turn/start', { turn: 1 })
    session.append(
      'user/message',
      createUserMessage({ content: [{ type: 'text', text: 'u' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' },
    )
    session.append('step/start', { turn: 1, step: 1 })
    const args = JSON.stringify({
      topic: 't',
      content: [
        { startRef: 'm0001', endRef: 'm0002', summary: 'first summary' },
        { startRef: 'm0002', endRef: 'm0003', summary: 'second summary' },
      ],
    })
    session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'tool-call', id: CallId('c1'), name: 'compress', arguments: args }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })

    const result = cleanupInlineSummary(session, fixture.ctx.tokenMeter, 'c1', [
      undefined,
      'b2',
    ])
    expect(result.cleaned).toBe(true)

    const assistantSeq = session.surface.nodes.find((seq) => {
      const event = session.events[seq]
      return (
        event?.type === 'assistant/message' &&
        event.data.message.content.some(
          (block) => block.type === 'tool-call' && block.id === 'c1',
        )
      )
    })
    const assistant = assistantSeq === undefined ? undefined : session.events[assistantSeq]
    if (assistant?.type !== 'assistant/message') throw new Error('assistant missing')
    const call = assistant.data.message.content.find(
      (block) => block.type === 'tool-call' && block.id === 'c1',
    )
    const parsed = JSON.parse((call as { arguments: string }).arguments) as {
      content: Array<{ summary: string }>
    }
    expect(parsed.content[0]!.summary).toBe('first summary')
    expect(parsed.content[1]!.summary).toBe('[stored in b2]')
  })
})
