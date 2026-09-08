import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { cleanupInlineSummary, inlineCleanupMarker } from '../../src/compress/inline-cleanup.js'

describe('inline cleanup indexed mapping (M6.0)', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('rewrites every summary with explicit committed/rejected plugin provenance', () => {
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
          content: [
            { type: 'tool-call', id: ToolCallId('c1'), name: 'compress', arguments: args },
          ],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })

    const result = cleanupInlineSummary(session, fixture.ctx.tokenMeter, 'c1', [
      { status: 'rejected', code: 'RECENT_RANGE' },
      { status: 'committed', blockRef: 'b2' },
    ])
    expect(result).toMatchObject({ cleaned: true, requested: 2, rewritten: 2, unhandled: 0 })

    const assistantSeq = session.surface.nodes.find((seq) => {
      const event = session.eventAt(seq)
      return (
        event?.type === 'assistant/message' &&
        event.data.message.content.some(
          (block) => block.type === 'tool-call' && block.id === 'c1',
        )
      )
    })
    const assistant = assistantSeq === undefined ? undefined : session.eventAt(assistantSeq)
    if (assistant?.type !== 'assistant/message') throw new Error('assistant missing')
    const call = assistant.data.message.content.find(
      (block) => block.type === 'tool-call' && block.id === 'c1',
    )
    const parsed = JSON.parse((call as { arguments: string }).arguments) as {
      content: Array<{ summary: string }>
    }
    expect(parsed.content[0]!.summary).toBe(
      inlineCleanupMarker({ status: 'rejected', code: 'RECENT_RANGE' }),
    )
    expect(parsed.content[1]!.summary).toBe(
      inlineCleanupMarker({ status: 'committed', blockRef: 'b2' }),
    )
  })

  it('is idempotent and replaces the legacy ambiguous marker', () => {
    const session = Session.create(SessionId('cleanup-idempotent'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const args = JSON.stringify({
      topic: 't',
      content: [{ startRef: 'm0001', endRef: 'm0002', summary: '[stored in b1]' }],
    })
    session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [
            {
              type: 'tool-call',
              id: ToolCallId('c-idempotent'),
              name: 'compress',
              arguments: args,
            },
          ],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )

    const status = { status: 'committed' as const, blockRef: 'b1' }
    const first = cleanupInlineSummary(session, fixture.ctx.tokenMeter, 'c-idempotent', [
      status,
    ])
    const eventCount = session.snapshotEvents().length
    const second = cleanupInlineSummary(session, fixture.ctx.tokenMeter, 'c-idempotent', [
      status,
    ])

    expect(first).toMatchObject({ cleaned: true, requested: 1, rewritten: 1, unhandled: 0 })
    expect(second).toMatchObject({ cleaned: false, requested: 1, rewritten: 0, unhandled: 0 })
    expect(second.warning).toContain('already cleaned')
    expect(session.snapshotEvents()).toHaveLength(eventCount)
    expect(
      session
        .deriveMessages()
        .flatMap((message) => message.content)
        .find((block) => block.type === 'tool-call') &&
        JSON.parse(
          (
            session
              .deriveMessages()
              .flatMap((message) => message.content)
              .find((block) => block.type === 'tool-call') as { arguments: string }
          ).arguments,
        ).content[0].summary,
    ).toBe(inlineCleanupMarker(status))
  })

  it('does not trust a model-authored cleanup marker with the wrong outcome', () => {
    const session = Session.create(SessionId('cleanup-fake-marker'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const fakeMarker =
      '<dcp-inline-cleanup provenance="dsh-dcp" status="committed" block-ref="b999" />'
    const args = JSON.stringify({
      topic: 't',
      content: [{ startRef: 'm0001', endRef: 'm0002', summary: fakeMarker }],
    })
    session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [
            {
              type: 'tool-call',
              id: ToolCallId('c-fake-marker'),
              name: 'compress',
              arguments: args,
            },
          ],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )

    const result = cleanupInlineSummary(session, fixture.ctx.tokenMeter, 'c-fake-marker', [
      { status: 'rejected', code: 'STALE_REF' },
    ])
    expect(result).toMatchObject({ cleaned: true, requested: 1, rewritten: 1, unhandled: 0 })
    const call = session
      .deriveMessages()
      .flatMap((message) => message.content)
      .find((block) => block.type === 'tool-call' && block.id === 'c-fake-marker')
    expect(call?.type).toBe('tool-call')
    expect(JSON.parse((call as { arguments: string }).arguments).content[0].summary).toBe(
      inlineCleanupMarker({ status: 'rejected', code: 'STALE_REF' }),
    )
  })

  it('replaces malformed arguments with a short parseable marker', () => {
    // The fixture's invariant companions observe this store-owned session;
    // successful append/replacement therefore proves the cleanup event shape
    // is valid under the host contract, not only under detached replay.
    const session = fixture.ctx.sessions.create(SessionId('cleanup-malformed-arguments'))
    const longSummary = 'x'.repeat(4121)
    const malformedArguments = `{"topic":"t","content":[{"summary":"${longSummary}"}`
    const otherArguments = JSON.stringify({
      topic: 't',
      content: [{ startRef: 'm0001', endRef: 'm0002', summary: 'other compress call' }],
    })

    session.append('turn/start', { turn: 1 })
    session.append(
      'user/message',
      createUserMessage({ content: [{ type: 'text', text: 'u' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' },
    )
    session.append('step/start', { turn: 1, step: 1 })
    session.append(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [
            {
              type: 'tool-call',
              id: ToolCallId('c-malformed'),
              name: 'compress',
              arguments: malformedArguments,
            },
            {
              type: 'tool-call',
              id: ToolCallId('c-other'),
              name: 'compress',
              arguments: otherArguments,
            },
          ],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    const call = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('c-malformed'),
      name: 'compress',
      arguments: malformedArguments,
    })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: ToolCallId('c-other'),
      name: 'compress',
      arguments: otherArguments,
    })

    const first = cleanupInlineSummary(session, fixture.ctx.tokenMeter, 'c-malformed', [
      { status: 'rejected', code: 'UNKNOWN' },
    ])

    expect(first).toMatchObject({ cleaned: true, requested: 1, rewritten: 1, unhandled: 0 })
    const derivedCall = session
      .deriveMessages()
      .flatMap((message) => message.content)
      .find((block) => block.type === 'tool-call' && block.id === 'c-malformed')
    expect(derivedCall?.type).toBe('tool-call')
    if (derivedCall?.type !== 'tool-call') throw new Error('cleaned call missing')
    expect(JSON.parse(derivedCall.arguments)).toEqual({
      dcpCleanup:
        '<dcp-inline-cleanup provenance="dsh-dcp" status="rejected" code="MALFORMED_ARGS" />',
    })
    expect(JSON.stringify(session.deriveMessages())).not.toContain(longSummary)
    const untouchedCall = session
      .deriveMessages()
      .flatMap((message) => message.content)
      .find((block) => block.type === 'tool-call' && block.id === 'c-other')
    expect(untouchedCall?.type).toBe('tool-call')
    if (untouchedCall?.type !== 'tool-call') throw new Error('other call missing')
    expect(untouchedCall.arguments).toBe(otherArguments)

    // The raw append-only history remains auditable, while the derived
    // surface contains only the short marker.
    expect(
      session
        .snapshotEvents()
        .some(
          (event) =>
            event.type === 'assistant/message' &&
            event.data.message.content.some(
              (block) => block.type === 'tool-call' && block.arguments.includes(longSummary),
            ),
        ),
    ).toBe(true)

    const eventCount = session.snapshotEvents().length
    const second = cleanupInlineSummary(session, fixture.ctx.tokenMeter, 'c-malformed', [
      { status: 'rejected', code: 'UNKNOWN' },
    ])
    expect(second).toMatchObject({ cleaned: false, requested: 1, rewritten: 0, unhandled: 0 })
    expect(second.warning).toContain('already cleaned')
    expect(session.snapshotEvents()).toHaveLength(eventCount)
    expect(call.type).toBe('tool/call')
  })
})
