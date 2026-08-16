/**
 * M0/E-03 prototype: deterministic classification of a compaction bracket
 * prefix from the durable log. M1 will fold this into the full replay layer.
 *
 * @module dsh-dcp/protocol/recovery
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'

export type PartialCommitClass =
  | 'none'
  | 'live-orphan-start'
  | 'stale-orphan-start'
  | 'summary-without-replace'
  | 'recovered-unclosed'
  | 'failed-attempt'
  | 'committed'

interface BracketState {
  startSeq: number
  summarySeq?: number
  replaceSeq?: number
  endSeq?: number
  endError?: string
}

/**
 * Classify the most recent compaction bracket in an event prefix.
 *
 * Rules (revised PLAN §6.5):
 * - no `compaction/start`                -> none
 * - start without end and no replace:
 *   - a newer `session/end-seed` proves the bracket belongs to an earlier
 *     lifecycle -> stale-orphan-start (not a live lock)
 *   - otherwise -> live-orphan-start
 * - start + summary, no replace          -> summary-without-replace
 * - replace visible, no end              -> recovered-unclosed (surface wins)
 * - start..end with replace              -> committed
 * - start..end(error) without replace    -> failed-attempt
 */
export function classifyCompactionPrefix(events: readonly SessionEvent[]): PartialCommitClass {
  let bracket: BracketState | undefined
  let endSeedAfterStart = false

  for (const event of events) {
    switch (event.type) {
      case 'session/end-seed':
        if (bracket !== undefined) endSeedAfterStart = true
        break
      case 'compaction/start':
        bracket = { startSeq: event.seq }
        endSeedAfterStart = false
        break
      case 'compaction/summary':
        if (bracket !== undefined) bracket.summarySeq = event.seq
        break
      case 'compaction/end':
        if (bracket !== undefined) {
          bracket.endSeq = event.seq
          bracket.endError = event.data.error
        }
        break
      case 'user/message':
        if (
          bracket !== undefined &&
          event.surfaceOp !== undefined &&
          event.surfaceOp !== 'append' &&
          event.surfaceOp.op === 'replace'
        ) {
          bracket.replaceSeq = event.seq
        }
        break
    }
  }

  if (bracket === undefined) return 'none'
  if (bracket.endSeq !== undefined) {
    return bracket.replaceSeq === undefined ? 'failed-attempt' : 'committed'
  }
  if (bracket.replaceSeq !== undefined) return 'recovered-unclosed'
  if (bracket.summarySeq !== undefined) return 'summary-without-replace'
  return endSeedAfterStart ? 'stale-orphan-start' : 'live-orphan-start'
}
