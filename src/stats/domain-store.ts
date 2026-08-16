/**
 * Real dsh-storage-domain wiring for DCP stats (M7.0).
 *
 * @module dsh-dcp/stats/domain-store
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  aggregateDomainStats,
  syncDomainStats,
  type DcpDomainRecordV1,
  type DcpStatsStore,
} from './domain.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Message } from '@deepseek-ai/dsh-llm'

const ledgerSchema = z.object({
  blockCount: z.number(),
  activeBlockCount: z.number(),
  pruneReplacements: z.number(),
  shadowedTokens: z.number(),
  checkpointTokens: z.number(),
  pruneTokens: z.number(),
  expansionTokens: z.number(),
  markerTokens: z.number(),
  historyReduction: z.number(),
})

const recordSchema = z.object({
  v: z.literal(1),
  eventCount: z.number(),
  ledger: ledgerSchema,
  updatedAt: z.string(),
})

export const dcpStatsDomainSpec = defineDomain({
  name: 'dcp_stats',
  version: 1,
  tables: {
    sessions: domainTable(recordSchema),
  },
})

export interface DcpStatsHandle {
  store: DcpStatsStore
  close(): Promise<void>
}

export async function openDcpStatsStore(ctx: Context): Promise<DcpStatsHandle | undefined> {
  const facility = ctx.get('storageDomain') as
    | {
        open(spec: typeof dcpStatsDomainSpec): Promise<{
          table(name: 'sessions'): {
            get(key: string): DcpDomainRecordV1 | undefined
            put(key: string, value: DcpDomainRecordV1): Promise<void>
            entries(): IterableIterator<[string, DcpDomainRecordV1]>
          }
          close(): Promise<void>
        }>
      }
    | undefined
  if (facility === undefined) return undefined
  const domain = await facility.open(dcpStatsDomainSpec)
  const table = domain.table('sessions')
  const store: DcpStatsStore = {
    read: (sessionId) => table.get(sessionId),
    write: (sessionId, record) => table.put(sessionId, record),
    list: () => table.entries(),
  }
  return { store, close: () => domain.close() }
}

export const dcpStatsStores = new WeakMap<Context, DcpStatsStore>()

export function registerDcpStatsStore(ctx: Context, store: DcpStatsStore): void {
  dcpStatsStores.set(ctx, store)
}

export function unregisterDcpStatsStore(ctx: Context): void {
  dcpStatsStores.delete(ctx)
}

export function getDcpStatsStore(ctx: Context): DcpStatsStore | undefined {
  return dcpStatsStores.get(ctx)
}

export async function syncToDomain(
  ctx: Context,
  sessionId: string,
  events: readonly SessionEvent[],
  estimateMessage?: (message: Message) => number,
): Promise<{
  record?: DcpDomainRecordV1
  aggregate?: ReturnType<typeof aggregateDomainStats>
}> {
  const store = getDcpStatsStore(ctx)
  if (store === undefined) return {}
  try {
    const record = await syncDomainStats(store, sessionId, events, estimateMessage)
    return { record, aggregate: aggregateDomainStats(store) }
  } catch {
    return {}
  }
}
