/**
 * Automatic strategy application (agent/pre-step).
 *
 * @module dsh-dcp/strategies/index
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import type { DcpConfig } from '../config.js'
import { applyDeduplication } from './deduplication.js'
import { applyPurgeErrors } from './purge-errors.js'

export interface StrategyResult {
  deduplicated: number
  purged: number
  tokensSaved: number
}

export function applyAutomaticStrategies(
  session: Session,
  tokenMeter: TokenMeter,
  config: DcpConfig,
  manualActive = false,
): StrategyResult {
  if (manualActive && !config.manualMode.automaticStrategies) {
    return { deduplicated: 0, purged: 0, tokensSaved: 0 }
  }
  const dedup = config.strategies.deduplication.enabled
    ? applyDeduplication(session, tokenMeter, config)
    : { replaced: 0, tokensSaved: 0 }
  const purge = config.strategies.purgeErrors.enabled
    ? applyPurgeErrors(session, tokenMeter, config)
    : { purged: 0, tokensSaved: 0 }
  return {
    deduplicated: dedup.replaced,
    purged: purge.purged,
    tokensSaved: dedup.tokensSaved + purge.tokensSaved,
  }
}
