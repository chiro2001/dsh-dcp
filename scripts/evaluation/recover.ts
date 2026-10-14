import {
  createLedger,
  costOf,
  type RunDescriptor,
  type RunRecord,
  type Usage,
} from './ledger.js'
import { priceAt } from './pricing.js'

/** Recover atomic usage snapshots even when Harbor never wrote its trial result. */
export function recoverRun(
  partial: RunRecord | null,
  descriptor: RunDescriptor,
  finishedAt: number,
): RunRecord {
  if (!Number.isFinite(finishedAt) || finishedAt < 0)
    throw new Error('Invalid recovery finish time')
  if (!partial)
    return createLedger(descriptor, priceAt(descriptor.startedAt, descriptor.model)).finishRun({
      outcome: 'infrastructure_error',
      finishedAt,
    })
  for (const field of ['taskId', 'arm', 'replicate', 'model', 'provider'] as const)
    if (partial[field] !== descriptor[field])
      throw new Error(`Ledger identity mismatch: ${field}`)
  const record = structuredClone(partial)
  const totals: Required<Usage> = {
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  }
  let knownCost = record.externalCost
  if (!Number.isFinite(knownCost) || knownCost < 0) throw new Error('Invalid external cost')
  for (const attempt of record.attempts) {
    if (attempt.status === 'pending') {
      attempt.status = 'aborted'
      attempt.finishedAt = finishedAt
      attempt.usage = null
      attempt.cost = null
      attempt.error = 'Controller ended before provider accounting completed'
    } else if (attempt.usage) {
      attempt.cost = costOf(attempt.usage, attempt.prices)
      knownCost += attempt.cost
      for (const field of Object.keys(totals) as Array<keyof Required<Usage>>)
        totals[field] += attempt.usage[field] ?? 0
    } else attempt.cost = null
  }
  record.outcome = 'infrastructure_error'
  record.success = false
  record.finishedAt = finishedAt
  record.knownCost = knownCost
  record.usageTotals = totals
  record.usageComplete =
    record.attempts.length > 0 && record.attempts.every((attempt) => attempt.cost !== null)
  record.totalCost = record.usageComplete ? knownCost : null
  return record
}
