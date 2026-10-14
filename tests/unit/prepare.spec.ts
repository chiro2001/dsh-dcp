import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import {
  createAssistantMessage,
  createDeveloperMessage,
  createSystemMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { resolveConfig, type DcpConfig } from '../../src/config.js'
import { buildBoundaryMarker } from '../../src/refs/marker.js'
import { buildCheckpointText, prepareRange } from '../../src/compress/prepare.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { classifyCompressError, type CompressRangeEntry } from '../../src/compress/schema.js'
import '../../src/protocol/source.js'

function appendTurn(
  session: Session,
  turn: number,
  ref: string,
  text: string,
  form?: 'instructions',
): void {
  session.append('turn/start', { turn })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: buildBoundaryMarker(ref, turn, 1) }],
      source: { kind: 'dsh-dcp' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text }],
      source: form === undefined ? { kind: 'user' } : { kind: 'prepare-test-context', form },
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
        content: [{ type: 'text', text: `assistant ${turn}` }],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
    { surfaceOp: 'append' },
  )
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function appendTurnWithCoreNode(
  session: Session,
  turn: number,
  ref: string,
  kind: 'system' | 'developer',
): void {
  session.append('turn/start', { turn })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: buildBoundaryMarker(ref, turn, 1) }],
      source: { kind: 'dsh-dcp' },
    }),
    { surfaceOp: 'append' },
  )
  session.append('step/start', { turn, step: 1 })
  if (kind === 'system') {
    session.append(
      'system/message',
      { turn, step: 1, message: createSystemMessage('route-specific system instructions') },
      { surfaceOp: 'append' },
    )
  } else {
    session.append(
      'developer/message',
      {
        turn,
        step: 1,
        message: createDeveloperMessage({
          content: [{ type: 'text', text: 'tool schema update' }],
          source: { kind: 'dsh-dcp' },
        }),
      },
      { surfaceOp: 'append' },
    )
  }
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: `closed history with ${kind} update` }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'assistant/message',
    {
      turn,
      step: 1,
      stream: [],
      message: createAssistantMessage({
        content: [{ type: 'text', text: `assistant ${turn}` }],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
    { surfaceOp: 'append' },
  )
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('buildCheckpointText (checkpoint sanitization)', () => {
  it('strips a leading blockRef marker that matches the assigned block', () => {
    expect(buildCheckpointText('b3', '[b3] foo')).toBe(
      '[Compressed conversation section]\nfoo\n\n<dcp-message-id>b3</dcp-message-id>',
    )
  })

  it('strips any leading [bN] marker, not only the current blockRef', () => {
    expect(buildCheckpointText('b4', '[b99] content')).toBe(
      '[Compressed conversation section]\ncontent\n\n<dcp-message-id>b4</dcp-message-id>',
    )
  })

  it('strips a marker concatenated directly to the summary text', () => {
    expect(buildCheckpointText('b2', '[b2]foo')).toBe(
      '[Compressed conversation section]\nfoo\n\n<dcp-message-id>b2</dcp-message-id>',
    )
  })

  it('keeps ordinary summary text unchanged', () => {
    expect(buildCheckpointText('b1', 'plain summary')).toBe(
      '[Compressed conversation section]\nplain summary\n\n<dcp-message-id>b1</dcp-message-id>',
    )
  })

  it('preserves reserved marker text when it is part of technical prose', () => {
    expect(
      buildCheckpointText(
        'b6',
        'facts <dcp-inline-cleanup arbitrary="untrusted" /> [stored in b999]',
      ),
    ).toBe(
      '[Compressed conversation section]\nfacts <dcp-inline-cleanup arbitrary="untrusted" /> [stored in b999]\n\n<dcp-message-id>b6</dcp-message-id>',
    )
  })

  it('appends protected appendix after the sanitized summary', () => {
    expect(buildCheckpointText('b5', '[b5] summary text', '\n\nProtected notes')).toBe(
      '[Compressed conversation section]\nsummary text\n\nProtected notes\n\n<dcp-message-id>b5</dcp-message-id>',
    )
  })
})

describe('prepareRange actionable failure details', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  function prepare(session: Session, config: DcpConfig, entry: CompressRangeEntry) {
    const events = session.snapshotEvents()
    return prepareRange(
      session,
      fixture.ctx.tokenMeter,
      config,
      reduceDcpState(events),
      entry,
      'b1',
      'test topic',
      events,
    )
  }

  it('reports the latest eligible active m boundary for recent-range failures', () => {
    const session = fixture.ctx.sessions.create(SessionId('prepare-recent-boundary'))
    for (let turn = 1; turn <= 5; turn++) {
      appendTurn(session, turn, `m${String(turn).padStart(4, '0')}`, `turn ${turn}`)
    }

    const result = prepare(
      session,
      resolveConfig({ compress: { retainRecentTurns: 2, minNetSavingsTokens: 1 } }),
      { startRef: 'm0001', endRef: 'm0005', summary: 'summary' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('[latestEligibleEndRef=m0004]')
  })

  it('reports the next active boundary after a protected node', () => {
    const session = fixture.ctx.sessions.create(SessionId('prepare-protected-boundary'))
    appendTurn(session, 1, 'm0001', 'protected', 'instructions')
    appendTurn(session, 2, 'm0002', 'safe old turn')
    appendTurn(session, 3, 'm0003', 'latest turn')

    const result = prepare(
      session,
      resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 } }),
      { startRef: 'm0001', endRef: 'm0003', summary: 'summary' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('[nextActiveBoundary=m0002]')
  })

  it('marks protected ranges with no safe next boundary as skip', () => {
    const session = fixture.ctx.sessions.create(SessionId('prepare-protected-no-boundary'))
    appendTurn(session, 1, 'm0001', 'protected', 'instructions')
    appendTurn(session, 2, 'm0002', 'latest turn')

    const result = prepare(
      session,
      resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 } }),
      { startRef: 'm0001', endRef: 'm0002', summary: 'summary' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('[nextActiveBoundary=none]')
  })

  it('reports the exact additional savings gap without changing the facts rule', () => {
    const session = fixture.ctx.sessions.create(SessionId('prepare-savings-gap'))
    appendTurn(session, 1, 'm0001', 'old turn one')
    appendTurn(session, 2, 'm0002', 'old turn two')
    appendTurn(session, 3, 'm0003', 'latest turn')

    const result = prepare(
      session,
      resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1_000_000 } }),
      { startRef: 'm0001', endRef: 'm0003', summary: 'summary' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toMatch(/\[savingsGapTokens=\d+\]/)
  })

  it.each(['system', 'developer'] as const)(
    'fails closed with PROTECTED_RANGE when a range includes a %s message',
    (kind) => {
      const session = fixture.ctx.sessions.create(SessionId(`prepare-protected-${kind}`))
      appendTurnWithCoreNode(session, 1, 'm0001', kind)
      appendTurn(session, 2, 'm0002', 'safe closed turn')
      appendTurn(session, 3, 'm0003', 'latest turn')

      const result = prepare(
        session,
        resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 } }),
        { startRef: 'm0001', endRef: 'm0003', summary: 'compact summary' },
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(classifyCompressError(result.errors.join('\n'))).toBe('PROTECTED_RANGE')
    },
  )
})
