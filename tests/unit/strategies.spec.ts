import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Session, SessionId, type Session as SessionType } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { resolveConfig, type DcpConfig } from '../../src/config.js'
import { applyDeduplication, dedupCandidates } from '../../src/strategies/deduplication.js'
import { applyPurgeErrors, purgeTargets } from '../../src/strategies/purge-errors.js'
import { applyAutomaticStrategies } from '../../src/strategies/index.js'

function config(overrides: Record<string, unknown> = {}): DcpConfig {
  return resolveConfig({ compress: { retainRecentTurns: 1 }, ...overrides })
}

function toolTurn(
  session: SessionType,
  turn: number,
  callId: string,
  tool: string,
  args: string,
  isError = false,
  extraResultData: Record<string, unknown> = {},
  resultText?: string,
): void {
  session.append('turn/start', { turn })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: `user ${turn}` }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append('step/start', { turn, step: 1 })
  session.append(
    'assistant/message',
    {
      turn,
      step: 1,
      stream: [],
      message: createAssistantMessage({
        content: [
          { type: 'tool-call', id: ToolCallId(callId), name: tool, arguments: args },
          { type: 'text', text: `assistant ${turn}` },
        ],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
    { surfaceOp: 'append' },
  )
  const call = session.append('tool/call', {
    turn,
    step: 1,
    callId: ToolCallId(callId),
    name: tool,
    arguments: args,
  })
  session.append(
    'tool/result',
    {
      turn,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId(callId),
        content: [
          {
            type: 'text',
            text:
              resultText ??
              (isError ? `error text ${turn}` : `output ${turn} with enough detail to price`),
          },
        ],
        isError,
      }),
      ...extraResultData,
    },
    { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
  )
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('automatic strategies (M3)', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('deduplicates identical tool calls, keeps the last, and is idempotent', () => {
    const session = Session.create(SessionId('dedup-test'))
    toolTurn(
      session,
      1,
      'c1',
      'read',
      '{"path":"a.txt"}',
      false,
      {},
      `output 1 with details. ${'file context '.repeat(100)}`,
    )
    toolTurn(
      session,
      2,
      'c2',
      'read',
      '{"path":"a.txt"}',
      false,
      {},
      `output 2 with details. ${'file context '.repeat(100)}`,
    )
    toolTurn(session, 3, 'c3', 'grep', '{"pattern":"x"}')
    session.append('turn/start', { turn: 4 })

    const candidates = dedupCandidates(session, config())
    expect(candidates.map((target) => target.callId)).toEqual(['c1'])

    const first = applyDeduplication(session, fixture.ctx.tokenMeter, config())
    expect(first.replaced).toBe(1)
    const second = applyDeduplication(session, fixture.ctx.tokenMeter, config())
    expect(second.replaced).toBe(0)

    const text = session
      .deriveMessages()
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('[duplicate read output removed')
    expect(text).toContain('output 2')
  })

  it('leaves short duplicate output and the raw log untouched when cleanup would grow it', () => {
    const session = Session.create(SessionId('dedup-short-result'))
    toolTurn(session, 1, 'short-c1', 'read', '{"path":"short.txt"}', false, {}, 'ok')
    toolTurn(session, 2, 'short-c2', 'read', '{"path":"short.txt"}', false, {}, 'ok')
    session.append('turn/start', { turn: 3 })
    const eventsBefore = session.snapshotEvents()
    const surfaceBefore = [...session.surface.nodes]

    const result = applyDeduplication(session, fixture.ctx.tokenMeter, config())

    expect(result.replaced).toBe(0)
    expect(session.surface.nodes).toEqual(surfaceBefore)
    expect(session.snapshotEvents()).toEqual(eventsBefore)
  })

  it('reports net token savings for long duplicate output and remains idempotent', () => {
    const session = Session.create(SessionId('dedup-net-savings'))
    const output = 'Long tool output with useful details. '.repeat(120)
    toolTurn(session, 1, 'long-c1', 'read', '{"path":"long.txt"}', false, {}, output)
    toolTurn(session, 2, 'long-c2', 'read', '{"path":"long.txt"}', false, {}, output)
    session.append('turn/start', { turn: 3 })
    const original = session
      .snapshotEvents()
      .find(
        (event) =>
          event.type === 'tool/result' &&
          String(event.data.message.source.callId) === 'long-c1',
      )
    expect(original?.type).toBe('tool/result')
    if (original?.type !== 'tool/result') throw new Error('original duplicate result missing')
    const originalTokens = fixture.ctx.tokenMeter.estimateMessage(original.data.message)

    const first = applyDeduplication(session, fixture.ctx.tokenMeter, config())
    const replacement = session
      .snapshotEvents()
      .findLast(
        (event) =>
          event.type === 'tool/result' &&
          event.surfaceOp !== 'append' &&
          String(event.data.message.source.callId) === 'long-c1',
      )
    expect(replacement?.type).toBe('tool/result')
    if (replacement?.type !== 'tool/result') throw new Error('dedup replacement missing')
    const replacementTokens = fixture.ctx.tokenMeter.estimateMessage(replacement.data.message)
    const eventsAfterFirst = session.snapshotEvents()
    const surfaceAfterFirst = [...session.surface.nodes]

    expect(first.replaced).toBe(1)
    expect(originalTokens - replacementTokens).toBeGreaterThan(0)
    expect(first.tokensSaved).toBe(originalTokens - replacementTokens)
    expect(applyDeduplication(session, fixture.ctx.tokenMeter, config())).toEqual({
      replaced: 0,
      tokensSaved: 0,
    })
    expect(session.snapshotEvents()).toEqual(eventsAfterFirst)
    expect(session.surface.nodes).toEqual(surfaceAfterFirst)
  })

  it('preserves non-content tool/result fields through dedup replacement', () => {
    // dsh's surface invariant allows a tool/result replacement to change only
    // the message content. An errored result carries extra durable data
    // (e.g. `error: {name, code}`) that must survive the replacement, or the
    // prune is rejected with "tool/result surface replacement may change only
    // content" and the turn fails (observed in a real Router-Spec session).
    const session = Session.create(SessionId('dedup-error-field'))
    toolTurn(
      session,
      1,
      'e1',
      'bash',
      '{"cmd":"false"}',
      true,
      { error: { name: 'FsError', code: 'FS_NOT_OBSERVED' } },
      `error text 1 with details. ${'failure context '.repeat(100)}`,
    )
    toolTurn(
      session,
      2,
      'e2',
      'bash',
      '{"cmd":"false"}',
      false,
      {},
      `output 2 with details. ${'failure context '.repeat(100)}`,
    )
    session.append('turn/start', { turn: 3 })

    const result = applyDeduplication(session, fixture.ctx.tokenMeter, config())
    expect(result.replaced).toBe(1)

    const replacements = session
      .snapshotEvents()
      .filter((event) => event.type === 'tool/result' && event.surfaceOp !== 'append')
    expect(replacements).toHaveLength(1)
    expect(replacements[0]?.data).toMatchObject({
      turn: 1,
      error: { name: 'FsError', code: 'FS_NOT_OBSERVED' },
    })

    const text = session
      .deriveMessages()
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('[duplicate bash output removed')
  })

  it('purges an errored single-call unit and is disabled by default', () => {
    const session = Session.create(SessionId('purge-test'))
    toolTurn(session, 1, 'e1', 'bash', '{"cmd":"false"}', true)
    session.append('turn/start', { turn: 2 })

    const withPurge = config({ strategies: { purgeErrors: { enabled: true, turns: 1 } } })
    const targets = purgeTargets(session, fixture.ctx.tokenMeter, withPurge)
    expect(targets).toHaveLength(1)
    const result = applyPurgeErrors(session, fixture.ctx.tokenMeter, withPurge)
    expect(result.purged).toBe(1)

    const text = session
      .deriveMessages()
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('[errored tool unit removed]')
    expect(text).toContain('error text 1')
    expect(text).not.toContain('assistant 1')

    // Default config keeps purge disabled; automatic application is a no-op.
    const fresh = Session.create(SessionId('purge-default'))
    toolTurn(fresh, 1, 'e2', 'bash', '{"cmd":"false"}', true)
    fresh.append('turn/start', { turn: 2 })
    const automatic = applyAutomaticStrategies(fresh, fixture.ctx.tokenMeter, config())
    expect(automatic.purged).toBe(0)
  })

  it('respects manual mode when automaticStrategies is off', () => {
    const session = Session.create(SessionId('manual-strategy'))
    toolTurn(session, 1, 'c1', 'read', '{"path":"a.txt"}')
    toolTurn(session, 2, 'c2', 'read', '{"path":"a.txt"}')
    session.append('turn/start', { turn: 3 })
    const result = applyAutomaticStrategies(
      session,
      fixture.ctx.tokenMeter,
      config({ manualMode: { automaticStrategies: false } }),
      true,
    )
    expect(result.deduplicated).toBe(0)
  })

  it('skips dedup for protected file patterns', () => {
    const session = Session.create(SessionId('dedup-protected'))
    toolTurn(session, 1, 'c1', 'read', '{"filePath":"a.txt"}')
    toolTurn(session, 2, 'c2', 'read', '{"filePath":"a.txt"}')
    session.append('turn/start', { turn: 3 })
    const protectedConfig = config({ protectedFilePatterns: ['**/*.txt'] })
    expect(dedupCandidates(session, protectedConfig)).toEqual([])
  })
})
