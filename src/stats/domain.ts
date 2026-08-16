/**
 * Cross-session aggregate adapter with catch-up (storage-domain wiring is
 * e2e-verified in M5; the adapter is transport-agnostic and unit-tested).
 *
 * @module dsh-dcp/stats/domain
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { computeSessionStats } from './session.js'

export interface DcpDomainAggregate {
  blockCount: number
  shadowedTokens: number
  netSavedTokens: number
  updatedAt: string
}

export interface DcpDomainRecord {
  lastProcessedSeq: number
  aggregate: DcpDomainAggregate
}

export interface DcpStatsStore {
  read(sessionId: string): DcpDomainRecord | undefined
  write(sessionId: string, record: DcpDomainRecord): void
}

export function syncDomainStats(
  store: DcpStatsStore,
  sessionId: string,
  events: readonly SessionEvent[],
): DcpDomainRecord {
  const existing = store.read(sessionId)
  if (existing !== undefined && existing.lastProcessedSeq >= events.length) {
    return existing
  }
  const stats = computeSessionStats(events)
  const record: DcpDomainRecord = {
    lastProcessedSeq: events.length,
    aggregate: {
      blockCount: stats.blockCount,
      shadowedTokens: stats.shadowedTokens,
      netSavedTokens: stats.netSavedTokens,
      updatedAt: new Date().toISOString(),
    },
  }
  store.write(sessionId, record)
  return record
}
