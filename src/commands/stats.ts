/**
 * /dcp stats — session statistics.
 *
 * @module dsh-dcp/commands/stats
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { computeSessionStats } from '../stats/session.js'

export function renderStats(ctx: Context, agent: Agent): string {
  const stats = computeSessionStats(agent.session.events)
  const measure = ctx.tokenMeter.measure(agent.session)
  return [
    'DCP statistics:',
    `  blocks:            ${stats.blockCount}`,
    `  shadowed tokens:   ~${stats.shadowedTokens}`,
    `  checkpoint tokens: ~${stats.checkpointTokens}`,
    `  net saved:         ~${stats.netSavedTokens}`,
    `  prune replacements: ${stats.pruneReplacements}`,
    `  marker tokens:     ~${stats.markerTokens}`,
    `  current surface:   ~${measure.surfaceTokens}`,
  ].join('\n')
}
