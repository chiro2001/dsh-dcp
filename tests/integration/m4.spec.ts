import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { resolveConfig, type DcpConfig } from '../../src/config.js'
import { executeCompressRange } from '../../src/compress/pipeline.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import {
  renderBlockShow,
  applyExpansion,
  applyRecompress,
} from '../../src/commands/recovery.js'
import { syncDomainStats, type DcpStatsStore } from '../../src/stats/domain.js'
import { buildMarkedSession, closeOpenTurn } from './m2-builder.js'

describe('M4: recovery commands and aggregate stats', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  function config(): DcpConfig {
    return resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 } })
  }

  it('expands a block into quoted context and recompresses it', () => {
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
        compactionId: CompactionId('m4-1'),
        compressCallId: 'dcp-call',
        authorMessageId: 'a4',
      },
    )
    closeOpenTurn(session, 4, 'dcp-call')

    // Open a control turn for the mutation.
    session.append('turn/start', { turn: 5 })
    session.append('step/start', { turn: 5, step: 1 })

    const expansion = applyExpansion(session, fixture.ctx.tokenMeter, 'b1')
    expect(expansion.ok).toBe(true)

    let text = session
      .deriveMessages()
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('[Expanded block b1]')
    expect(text).toContain('first user message')

    let state = reduceDcpState([...session.events])
    expect(state.blocks.find((block) => block.ref === 'b1')?.membership).toBe('expanded')
    expect(state.blocks.find((block) => block.ref === 'b2')?.meta.kind).toBe('expansion')

    const recompress = applyRecompress(session, fixture.ctx.tokenMeter, 'b1')
    expect(recompress.ok).toBe(true)

    text = session
      .deriveMessages()
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('first checkpoint summary')

    state = reduceDcpState([...session.events])
    const b3 = state.blocks.find((block) => block.ref === 'b3')
    expect(b3?.meta.kind).toBe('summary')
    expect(b3?.meta.recompressedFrom).toBe('b1')
    expect(state.blocks.find((block) => block.ref === 'b2')?.membership).toBe('consumed')
    expect(state.maxBlockNumber).toBe(3)

    // show --raw includes original leaves.
    const show = renderBlockShow(session, state, 'b3', true)
    expect(show).toContain('Original leaf nodes')
    expect(show).toContain('first user message')

    session.append('step/end', { turn: 5, step: 1 })
    session.append('turn/end', { turn: 5, reason: { kind: 'completed' } })
  })

  it('syncs domain aggregates idempotently with catch-up', async () => {
    const writes: Array<{ id: string; record: unknown }> = []
    const memory = new Map<string, Awaited<ReturnType<typeof syncDomainStats>>>()
    const store: DcpStatsStore = {
      read: (id) => memory.get(id),
      write: (id, record) => {
        memory.set(id, record)
        writes.push({ id, record })
      },
    }
    const session = buildMarkedSession(fixture.ctx)
    executeCompressRange(
      session,
      fixture.ctx.tokenMeter,
      config(),
      {
        topic: 't',
        content: [{ startRef: 'm0001', endRef: 'm0004', summary: 'summary' }],
      },
      {
        compactionId: CompactionId('m4-2'),
        compressCallId: 'dcp-call',
        authorMessageId: 'a4',
      },
    )

    const first = await syncDomainStats(store, 'session-1', [...session.events])
    expect(first.ledger.blockCount).toBe(1)
    expect(writes).toHaveLength(1)

    // A fresh store with the same events writes again; an up-to-date store is a no-op.
    const second = await syncDomainStats(store, 'session-1', [...session.events])
    expect(second.eventCount).toBe(first.eventCount)
    expect(writes).toHaveLength(1)
  })
})
