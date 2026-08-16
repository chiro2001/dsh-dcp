import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import { resolveConfig } from '../../src/config.js'
import { executeCompressRange } from '../../src/compress/pipeline.js'
import { aggregateDomainStats, syncDomainStats } from '../../src/stats/domain.js'
import {
  openDcpStatsStore,
  registerDcpStatsStore,
  unregisterDcpStatsStore,
} from '../../src/stats/domain-store.js'
import { renderDomainStats } from '../../src/commands/stats.js'
import { buildMarkedSession } from './m2-builder.js'

describe('M7.0: real dsh-storage-json domain wiring', () => {
  let fixture: ContractFixture
  let root: string
  let ctx: Context | undefined

  beforeEach(async () => {
    fixture = await mountContractFixture()
    root = await mkdtemp(join(tmpdir(), 'dcp-domain-'))
    ctx = fixture.ctx
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson as unknown as Plugin, { root })
    await ctx.plugin(StorageDomain as unknown as Plugin, { backend: 'json' })
  })

  afterEach(async () => {
    if (ctx !== undefined) {
      await ctx.fiber.dispose()
      ctx = undefined
    }
    await fixture.dispose()
    await rm(root, { recursive: true, force: true })
  })

  async function buildSessionWithBlock(): Promise<SessionId> {
    if (!ctx) throw new Error('ctx missing')
    const session = buildMarkedSession(ctx)
    executeCompressRange(
      session,
      ctx.tokenMeter,
      resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 } }),
      {
        topic: 't',
        content: [{ startRef: 'm0001', endRef: 'm0004', summary: 'domain summary' }],
      },
      {
        compactionId: CompactionId('domain-test'),
        compressCallId: 'dcp-call',
        authorMessageId: 'a4',
      },
    )
    return session.id
  }

  it('persists per-session snapshots and survives reopen', async () => {
    if (!ctx) throw new Error('ctx missing')
    const ids = []
    for (let index = 0; index < 5; index++) ids.push(await buildSessionWithBlock())

    const handle = await openDcpStatsStore(ctx)
    expect(handle).toBeDefined()
    if (!handle) return

    const estimate = (message: Message) => ctx!.tokenMeter.estimateMessage(message)
    const records = []
    for (const id of ids) {
      records.push(
        await syncDomainStats(handle.store, id, ctx.sessions.get(id)!.events, estimate),
      )
    }
    for (const record of records) expect(record.ledger.blockCount).toBe(1)
    expect(aggregateDomainStats(handle.store).sessionCount).toBe(5)
    await handle.close()
    await ctx.fiber.dispose()
    ctx = undefined

    // Reopen a fresh composition against the same root.
    const fresh = await mountContractFixture()
    await fresh.ctx.plugin(Storage)
    await fresh.ctx.plugin(StorageJson as unknown as Plugin, { root })
    await fresh.ctx.plugin(StorageDomain as unknown as Plugin, { backend: 'json' })
    const reopened = await openDcpStatsStore(fresh.ctx)
    expect(reopened).toBeDefined()
    if (reopened) {
      const loaded = reopened.store.read(ids[0]!)
      expect(loaded?.eventCount).toBe(records[0]!.eventCount)
      expect(loaded?.ledger.blockCount).toBe(1)
      expect(aggregateDomainStats(reopened.store).sessionCount).toBe(5)
      await reopened.close()
    }
    await fresh.dispose()
  })

  it('renders persistent domain stats as current when wired', async () => {
    if (!ctx) throw new Error('ctx missing')
    const session = buildMarkedSession(ctx)
    const handle = await openDcpStatsStore(ctx)
    expect(handle).toBeDefined()
    if (!handle) return
    registerDcpStatsStore(ctx, handle.store)
    const lines = await renderDomainStats(ctx, {
      session,
    } as never)
    expect(lines.join('\n')).toContain('persistent domain: current')
    unregisterDcpStatsStore(ctx)
    await handle.close()
  })
})
