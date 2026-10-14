import type { PriceSnapshot } from './ledger.js'

/** Frozen official quote read on 2026-10-14; refresh explicitly before a later evaluation. */
export const PRICE_PROVENANCE = {
  source: 'https://api-docs.deepseek.com/quick_start/pricing',
  retrievedAt: '2026-10-14',
  modelVersion: 'DeepSeek-V4.1-Flash',
  peakHoursUTC: 'Monday-Friday [01:00,04:00) and [06:00,10:00)',
} as const

export function priceAt(timestamp: number, model = 'deepseek-flash'): PriceSnapshot {
  if (model !== 'deepseek-flash') throw new Error(`Unsupported pricing model: ${model}`)
  const date = new Date(timestamp)
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime()))
    throw new Error('Invalid pricing timestamp')
  const day = date.getUTCDay()
  const hour = date.getUTCHours()
  const peak = day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
  const multiplier = peak ? 1 : 0.5
  return {
    currency: 'USD',
    date: date.toISOString().slice(0, 10),
    source: PRICE_PROVENANCE.source,
    retrievedAt: PRICE_PROVENANCE.retrievedAt,
    model,
    window: peak ? 'peak' : 'off-peak',
    rates: {
      uncachedInputPerMillion: 0.3 * multiplier,
      cacheReadPerMillion: 0.006 * multiplier,
      outputPerMillion: 1.2 * multiplier,
    },
  }
}
