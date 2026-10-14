import { describe, expect, it } from 'vitest'
import { priceAt } from '../../scripts/evaluation/pricing.js'

describe('evaluation price snapshots', () => {
  it('uses peak rates at the configured UTC weekday window boundaries', () => {
    const atOne = priceAt(Date.parse('2026-10-14T01:00:00.000Z'))
    const atFour = priceAt(Date.parse('2026-10-14T04:00:00.000Z'))
    const atSix = priceAt(Date.parse('2026-10-14T06:00:00.000Z'))
    const atTen = priceAt(Date.parse('2026-10-14T10:00:00.000Z'))

    expect(atOne).toMatchObject({
      currency: 'USD',
      date: '2026-10-14',
      rates: {
        uncachedInputPerMillion: 0.3,
        cacheReadPerMillion: 0.006,
        outputPerMillion: 1.2,
      },
    })
    expect(atOne.source).toEqual(expect.any(String))
    expect(atOne.source.length).toBeGreaterThan(0)
    expect(atFour.rates).toEqual({
      uncachedInputPerMillion: 0.15,
      cacheReadPerMillion: 0.003,
      outputPerMillion: 0.6,
    })
    expect(atSix.rates).toEqual(atOne.rates)
    expect(atTen.rates).toEqual(atFour.rates)
  })

  it('uses off-peak rates on weekends regardless of the UTC hour', () => {
    const saturdayAtTwo = priceAt(Date.parse('2026-10-17T02:00:00.000Z'))
    const sundayAtEight = priceAt(Date.parse('2026-10-18T08:00:00.000Z'))

    expect(saturdayAtTwo.rates).toEqual({
      uncachedInputPerMillion: 0.15,
      cacheReadPerMillion: 0.003,
      outputPerMillion: 0.6,
    })
    expect(sundayAtEight.rates).toEqual(saturdayAtTwo.rates)
  })

  it('rejects unsupported models rather than silently applying DeepSeek pricing', () => {
    expect(() => priceAt(Date.parse('2026-10-14T02:00:00.000Z'), 'unlisted-model')).toThrow(
      /model/i,
    )
  })
})
