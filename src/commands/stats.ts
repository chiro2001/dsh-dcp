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
  if (result.status === 'unavailable') {
    return [`persistent domain: unavailable (${result.reason ?? 'storageDomain not wired'})`]
  }
  if (result.status === 'stale') {
    const aggregate = result.aggregate
    return [
      `persistent domain: stale (${result.reason ?? 'sync failed'})`,
      ...(aggregate === undefined
        ? []
        : [
            `  sessions (old view): ${aggregate.sessionCount}`,
            `  blocks (old view):   ${aggregate.ledger.blockCount}`,
          ]),
      `  observed cursor: ${result.observedCursor}`,
    ]
  }
  if (!result.record || !result.aggregate) {
    return ['persistent domain: current (unexpected missing data)']
  }
  return [
    'persistent domain: current (single-process scope)',
    `  sessions:          ${result.aggregate?.sessionCount ?? 0}`,
    `  blocks:            ${result.aggregate?.ledger.blockCount ?? 0}`,
    `  history reduction: ~${result.aggregate?.ledger.historyReduction ?? 0}`,
    `  last sync:         ${result.record.updatedAt}`,
  ]
}
