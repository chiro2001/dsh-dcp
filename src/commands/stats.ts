/**
 * /dcp stats — session statistics.
 *
 * @module dsh-dcp/commands/stats
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { computeSessionStats } from '../stats/session.js'
import { syncToDomain } from '../stats/domain-store.js'

export function renderStats(ctx: Context, agent: Agent): string {
  const stats = computeSessionStats(agent.session.events, (message) =>
    ctx.tokenMeter.estimateMessage(message),
  )
  const measure = ctx.tokenMeter.measure(agent.session)
  return [
    'DCP statistics:',
    `  blocks (hist/act):  ${stats.blockCount} / ${stats.activeBlockCount}`,
    `  shadowed tokens:   ~${stats.shadowedTokens}`,
    `  checkpoint tokens: ~${stats.checkpointTokens}`,
    `  prune tokens:      ~${stats.pruneTokens}`,
    `  expansion delta:   ~${stats.expansionTokens}`,
    `  marker tokens:     ~${stats.markerTokens}`,
    `  history reduction: ~${stats.historyReduction}` +
      (stats.historyReduction < 0 ? ' (overhead)' : ''),
    `  prune replacements: ${stats.pruneReplacements}`,
    `  current surface:   ~${measure.surfaceTokens}`,
  ].join('\n')
}

export async function renderDomainStats(ctx: Context, agent: Agent): Promise<string[]> {
  const result = await syncToDomain(
    ctx,
    String(agent.session.id),
    agent.session.events,
    (message) => ctx.tokenMeter.estimateMessage(message),
  )
  if (result.record === undefined || result.aggregate === undefined) {
    return ['persistent domain: unavailable or stale (storageDomain not wired / sync failed)']
  }
  return [
    'persistent domain: current (single-process scope)',
    `  sessions:          ${result.aggregate.sessionCount}`,
    `  blocks:            ${result.aggregate.ledger.blockCount}`,
    `  history reduction: ~${result.aggregate.ledger.historyReduction}`,
    `  last sync:         ${result.record.updatedAt}`,
  ]
}
