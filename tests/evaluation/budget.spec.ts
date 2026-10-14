import { describe, expect, it } from 'vitest'
import { evaluateRequest } from '../../scripts/evaluation/budget.js'
import { priceAt } from '../../scripts/evaluation/pricing.js'

const peakPrices = priceAt(Date.parse('2026-10-14T01:00:00.000Z'))

const current = {
  attemptCount: 0,
  knownCost: 0.1,
  inputEstimateTokens: 10_000,
  nextMaxOutputTokens: 1_000,
  elapsedMs: 2_500,
}

const limits = {
  maxRequests: 2,
  maxCostUSD: 1,
  maxElapsedMs: 10_000,
  prices: peakPrices,
}

describe('evaluation request budget', () => {
  it('admits a request when its conservative reservation fits every remaining budget', () => {
    // Peak-rate reserve: 10k uncached input ($0.003) + 1k output ($0.0012).
    expect(evaluateRequest(current, limits)).toBeNull()
  })

  it('blocks before dispatch once the physical-attempt budget is exhausted', () => {
    expect(evaluateRequest({ ...current, attemptCount: 2 }, limits)).toBe('request_count')
  })

  it('blocks at the elapsed-time deadline even when request and cost budgets remain', () => {
    expect(evaluateRequest({ ...current, elapsedMs: 10_000 }, limits)).toBe('deadline')
    expect(evaluateRequest({ ...current, elapsedMs: 9_999 }, limits)).toBeNull()
  })

  it('reports the first exhausted constraint in request, deadline, then cost order', () => {
    const alreadyOverCost = {
      ...current,
      attemptCount: 2,
      knownCost: 10,
      elapsedMs: 10_000,
      inputEstimateTokens: 1_000_000,
    }
    expect(evaluateRequest(alreadyOverCost, { ...limits, maxCostUSD: 0.01 })).toBe(
      'request_count',
    )
    expect(
      evaluateRequest({ ...alreadyOverCost, attemptCount: 1 }, { ...limits, maxCostUSD: 0.01 }),
    ).toBe('deadline')
  })

  it('prices the input estimate at the uncached peak rate instead of assuming cache hits', () => {
    const state = {
      ...current,
      knownCost: 0,
      inputEstimateTokens: 1_000_000,
      nextMaxOutputTokens: 1,
    }

    // One million estimated input tokens reserve $0.30 at the peak miss rate,
    // before even adding the one-token output reserve.
    expect(
      evaluateRequest(state, {
        ...limits,
        maxCostUSD: 0.299,
      }),
    ).toBe('cost_reservation')
  })

  it('reserves the full next output allowance and admits an exact cost-boundary fit', () => {
    const state = {
      ...current,
      knownCost: 0,
      inputEstimateTokens: 0,
      nextMaxOutputTokens: 1_000_000,
    }

    // The full one-million-token output cap reserves exactly $1.20 at peak rates.
    expect(
      evaluateRequest(state, {
        ...limits,
        maxCostUSD: 1.2,
      }),
    ).toBeNull()
    expect(
      evaluateRequest(state, {
        ...limits,
        maxCostUSD: 1.19,
      }),
    ).toBe('cost_reservation')
  })

  it('counts already-known failed-attempt charges before reserving the next request', () => {
    const state = {
      ...current,
      knownCost: 0.99,
      inputEstimateTokens: 100_000,
      nextMaxOutputTokens: 10_000,
    }

    // Existing failures are already in knownCost; the next request adds $0.042.
    expect(evaluateRequest(state, limits)).toBe('cost_reservation')
  })

  it('rejects invalid negative or non-finite counters and an empty output reservation', () => {
    expect(() => evaluateRequest({ ...current, attemptCount: -1 }, limits)).toThrow()
    expect(() => evaluateRequest({ ...current, knownCost: Number.NaN }, limits)).toThrow()
    expect(() => evaluateRequest({ ...current, inputEstimateTokens: -1 }, limits)).toThrow()
    expect(() =>
      evaluateRequest({ ...current, inputEstimateTokens: Number.NaN }, limits),
    ).toThrow()
    expect(() => evaluateRequest({ ...current, nextMaxOutputTokens: 0 }, limits)).toThrow()
    expect(() => evaluateRequest({ ...current, elapsedMs: Number.NaN }, limits)).toThrow()
    expect(() => evaluateRequest(current, { ...limits, maxRequests: 0 })).toThrow()
    expect(() => evaluateRequest(current, { ...limits, maxCostUSD: Number.NaN })).toThrow()
    expect(() => evaluateRequest(current, { ...limits, maxElapsedMs: -1 })).toThrow()
  })
})
