import { costOf, type PriceSnapshot } from './ledger.js'

export function evaluateRequest(
  current: {
    attemptCount: number
    knownCost: number
    inputEstimateTokens: number
    nextMaxOutputTokens: number
    elapsedMs: number
  },
  limits: {
    maxRequests: number
    maxCostUSD: number
    maxElapsedMs: number
    prices: PriceSnapshot
  },
): 'request_count' | 'deadline' | 'cost_reservation' | null {
  for (const [field, value] of Object.entries(current))
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid budget ${field}`)
  if (!Number.isSafeInteger(current.attemptCount)) throw new Error('Invalid attemptCount')
  if (!Number.isSafeInteger(limits.maxRequests) || limits.maxRequests <= 0)
    throw new Error('Invalid maxRequests')
  if (!Number.isFinite(limits.maxCostUSD) || limits.maxCostUSD <= 0)
    throw new Error('Invalid maxCostUSD')
  if (!Number.isFinite(limits.maxElapsedMs) || limits.maxElapsedMs <= 0)
    throw new Error('Invalid maxElapsedMs')
  if (!Number.isSafeInteger(current.nextMaxOutputTokens) || current.nextMaxOutputTokens <= 0)
    throw new Error('Invalid output reservation')
  const reservation = costOf(
    {
      uncachedInputTokens: current.inputEstimateTokens,
      cacheReadTokens: 0,
      outputTokens: current.nextMaxOutputTokens,
    },
    limits.prices,
  )
  if (current.attemptCount >= limits.maxRequests) return 'request_count'
  if (current.elapsedMs >= limits.maxElapsedMs) return 'deadline'
  if (current.knownCost + reservation > limits.maxCostUSD) return 'cost_reservation'
  return null
}
