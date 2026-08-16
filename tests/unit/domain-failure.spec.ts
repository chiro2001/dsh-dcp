import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import {
  aggregateDomainStats,
  syncDomainStats,
  type DcpDomainRecordV1,
  type DcpStatsStore,
} from '../../src/stats/domain.js'
import { registerDcpStatsStore, unregisterDcpStatsStore } from '../../src/stats/domain-store.js'
import { renderDomainStats } from '../../src/commands/stats.js'

describe('M7.0: domain failure and catch-up semantics', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('shows unavailable when no store is wired', async () => {
    const agent = {
      session: { id: SessionId('no-store'), events: [] as never[] },
    } as never
    const lines = await renderDomainStats(fixture.ctx, agent)
    expect(lines.join('\n')).toContain('unavailable (storageDomain not wired)')
  })

  it('shows stale when writes fail', async () => {
    const failing: DcpStatsStore = {
      read: () => undefined,
      write: async () => {
        throw new Error('backend down')
      },
      list: () => [][Symbol.iterator]() as IterableIterator<[string, DcpDomainRecordV1]>,
    }
    registerDcpStatsStore(fixture.ctx, failing)
    const agent = {
      session: { id: SessionId('fail-session'), events: [] as never[] },
    } as never
    const lines = await renderDomainStats(fixture.ctx, agent)
    expect(lines.join('\n')).toContain('persistent domain: stale')
    expect(lines.join('\n')).toContain('backend down')
    unregisterDcpStatsStore(fixture.ctx)
  })

  it('shows stale with the old durable view after a write failure', async () => {
    const existing: DcpDomainRecordV1 = {
      v: 1,
      eventCount: 2,
      ledger: {
        blockCount: 1,
        activeBlockCount: 1,
        pruneReplacements: 0,
        shadowedTokens: 100,
        checkpointTokens: 20,
        pruneTokens: 0,
        expansionTokens: 0,
        markerTokens: 5,
        historyReduction: 75,
      },
      updatedAt: '2026-08-16T00:00:00.000Z',
    }
    const failing: DcpStatsStore = {
      read: () => existing,
      write: async () => {
        throw new Error('backend down')
      },
      list: () => [['s1', existing] as [string, DcpDomainRecordV1]][Symbol.iterator](),
    }
    registerDcpStatsStore(fixture.ctx, failing)
    const agent = {
      session: { id: SessionId('stale-session'), events: [null, null, null] as never[] },
    } as never
    const lines = await renderDomainStats(fixture.ctx, agent)
    expect(lines.join('\n')).toContain('persistent domain: stale')
    expect(lines.join('\n')).toContain('sessions (old view): 1')
    unregisterDcpStatsStore(fixture.ctx)
  })

  it('catch-up updates only forward and never regresses', async () => {
    const writes: string[] = []
    const memory = new Map<string, DcpDomainRecordV1>()
    const store: DcpStatsStore = {
      read: (id) => memory.get(id),
      write: (id, record) => {
        memory.set(id, record)
        writes.push(id)
      },
      list: () => memory.entries(),
    }
    const session = Session.create(SessionId('catchup'))
    for (let index = 0; index < 5; index++) {
      session.append(
        'user/message',
        {
          id: `u${index}`,
          role: 'user',
          content: [{ type: 'text', text: `user ${index}` }],
          source: { kind: 'user' },
        } as never,
        { surfaceOp: 'append' },
      )
    }

    const first = await syncDomainStats(store, 's1', [...session.events])
    expect(first.eventCount).toBe(5)
    const unchanged = await syncDomainStats(store, 's1', [...session.events])
    expect(unchanged.eventCount).toBe(5)
    expect(writes).toEqual(['s1'])

    session.append(
      'user/message',
      {
        id: 'u5',
        role: 'user',
        content: [{ type: 'text', text: 'user 5' }],
        source: { kind: 'user' },
      } as never,
      { surfaceOp: 'append' },
    )
    const updated = await syncDomainStats(store, 's1', [...session.events])
    expect(updated.eventCount).toBe(6)
    expect(writes).toEqual(['s1', 's1'])
    expect(aggregateDomainStats(store).sessionCount).toBe(1)
  })
})
