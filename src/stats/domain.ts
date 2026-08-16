/**
 * Cross-session aggregate: per-session snapshot records (v1) with catch-up.
 * Domain totals are computed by summing the latest records — never a global +=.
 *
 * @module dsh-dcp/stats/domain
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Message } from '@deepseek-ai/dsh-llm'
import { computeSessionStats, type SessionStats } from './session.js'

export interface DcpDomainRecordV1 {
  v: 1
  eventCount: number
  ledger: SessionStats
  updatedAt: string
}

export interface DcpStatsStore {
  read(sessionId: string): DcpDomainRecordV1 | undefined
  write(sessionId: string, record: DcpDomainRecordV1): void | Promise<void>
  list?(): IterableIterator<[string, DcpDomainRecordV1]>
}

export interface DcpDomainAggregate {
  sessionCount: number
  ledger: SessionStats
}

export async function syncDomainStats(
  store: DcpStatsStore,
  sessionId: string,
  events: readonly SessionEvent[],
  estimateMessage?: (message: Message) => number,
): Promise<DcpDomainRecordV1> {
  const eventCount = events.length
  const existing = store.read(sessionId)
  if (existing !== undefined && existing.eventCount >= eventCount) {
    return existing
  }
  const record: DcpDomainRecordV1 = {
    v: 1,
    eventCount,
    ledger: computeSessionStats(events, estimateMessage),
    updatedAt: new Date().toISOString(),
  }
  await store.write(sessionId, record)
  return record
}

export function aggregateDomainStats(store: DcpStatsStore): DcpDomainAggregate {
  const records = store.list === undefined ? [] : [...store.list()]
  const zero: SessionStats = {
    blockCount: 0,
    activeBlockCount: 0,
    pruneReplacements: 0,
    shadowedTokens: 0,
    checkpointTokens: 0,
    pruneTokens: 0,
    expansionTokens: 0,
    markerTokens: 0,
    historyReduction: 0,
  }
  const ledger: SessionStats = { ...zero }
  for (const [, record] of records) {
    ledger.blockCount += record.ledger.blockCount
    ledger.activeBlockCount += record.ledger.activeBlockCount
    ledger.pruneReplacements += record.ledger.pruneReplacements
    ledger.shadowedTokens += record.ledger.shadowedTokens
    ledger.checkpointTokens += record.ledger.checkpointTokens
    ledger.pruneTokens += record.ledger.pruneTokens
    ledger.expansionTokens += record.ledger.expansionTokens
    ledger.markerTokens += record.ledger.markerTokens
    ledger.historyReduction += record.ledger.historyReduction
  }
  return { sessionCount: records.length, ledger }
}
