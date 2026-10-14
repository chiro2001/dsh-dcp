import { describe, expect, it } from 'vitest'
import { createLedger } from '../../scripts/evaluation/ledger.js'
import { attemptMetadata, completeUsage, descriptor, prices } from './helpers.js'

describe('evaluation request ledger', () => {
  it('prices each request from a versioned usage snapshot and does not bill reasoning twice', () => {
    const ledger = createLedger(descriptor(), prices)
    const attemptId = ledger.startAttempt(attemptMetadata())

    ledger.finishAttempt(attemptId, {
      status: 'success',
      usage: completeUsage,
      finishedAt: 1_792_000_003_000,
    })
    const run = ledger.finishRun({
      outcome: 'success',
      finishedAt: 1_792_000_004_000,
      externalCost: 1.25,
    })

    // 1.25M * $0.27 + 2M * $0.07 + 0.30M * $1.10 + $1.25 external.
    // The 120k reasoning tokens are already part of outputTokens.
    expect(run.totalCost).toBeCloseTo(2.0575, 10)
    expect(run.knownCost).toBeCloseTo(2.0575, 10)
    expect(run.usageComplete).toBe(true)
    expect(run.success).toBe(true)
    expect(run.outcome).toBe('success')
    expect(run.attempts).toHaveLength(1)
    expect(run.attempts[0]).toMatchObject({
      metadata: attemptMetadata(),
      status: 'success',
      usage: completeUsage,
    })
    expect(run.usageTotals).toMatchObject({
      uncachedInputTokens: 1_250_000,
      cacheReadTokens: 2_000_000,
      outputTokens: 300_000,
      reasoningTokens: 120_000,
    })
    expect(run.attempts[0]).toMatchObject({ prices })
  })

  it('keeps a billed HTTP failure in the run cost even when the task fails', () => {
    const ledger = createLedger(descriptor({ runId: 'failed-run' }), prices)
    const attemptId = ledger.startAttempt(attemptMetadata())
    ledger.finishAttempt(attemptId, {
      status: 'http_error',
      usage: {
        uncachedInputTokens: 100_000,
        cacheReadTokens: 400_000,
        outputTokens: 20_000,
      },
      finishedAt: 1_792_000_003_000,
      error: 'provider returned an HTTP error after billing usage',
    })

    const run = ledger.finishRun({
      outcome: 'failure',
      finishedAt: 1_792_000_004_000,
    })

    // $0.027 uncached input + $0.028 cache reads + $0.022 output.
    expect(run.totalCost).toBeCloseTo(0.077, 12)
    expect(run.knownCost).toBeCloseTo(0.077, 12)
    expect(run.usageComplete).toBe(true)
    expect(run.success).toBe(false)
    expect(run.attempts[0]).toMatchObject({ status: 'http_error' })
  })

  it('rejects duplicate attempt finalization without changing the booked request', () => {
    const ledger = createLedger(descriptor(), prices)
    const attemptId = ledger.startAttempt(attemptMetadata())
    const finalization = {
      status: 'success' as const,
      usage: { uncachedInputTokens: 100, cacheReadTokens: 20, outputTokens: 10 },
      finishedAt: 1_792_000_003_000,
    }
    ledger.finishAttempt(attemptId, finalization)
    const before = ledger.snapshot()

    expect(() => ledger.finishAttempt(attemptId, finalization)).toThrow()
    expect(ledger.snapshot()).toEqual(before)
    expect(
      ledger.finishRun({ outcome: 'success', finishedAt: 1_792_000_004_000 }).attempts,
    ).toHaveLength(1)
  })

  it('rejects negative and NaN usage values without consuming the attempt', () => {
    const tokenFields = [
      'uncachedInputTokens',
      'cacheReadTokens',
      'outputTokens',
      'reasoningTokens',
    ] as const

    for (const field of tokenFields) {
      for (const invalidValue of [-1, Number.NaN]) {
        const ledger = createLedger(
          descriptor({ runId: `${field}-${String(invalidValue)}` }),
          prices,
        )
        const attemptId = ledger.startAttempt(attemptMetadata())
        const invalidUsage = {
          uncachedInputTokens: 1,
          cacheReadTokens: 2,
          outputTokens: 3,
          reasoningTokens: 1,
          [field]: invalidValue,
        }

        expect(() =>
          ledger.finishAttempt(attemptId, {
            status: 'success',
            usage: invalidUsage,
            finishedAt: 1_792_000_003_000,
          }),
        ).toThrow()

        ledger.finishAttempt(attemptId, {
          status: 'success',
          usage: { uncachedInputTokens: 1, cacheReadTokens: 2, outputTokens: 3 },
          finishedAt: 1_792_000_003_000,
        })
        expect(
          ledger.finishRun({ outcome: 'success', finishedAt: 1_792_000_004_000 }).usageComplete,
        ).toBe(true)
      }
    }
  })

  it('finalizes an unfinished request as unknown cost instead of silently treating it as free', () => {
    const ledger = createLedger(descriptor(), prices)
    ledger.startAttempt(attemptMetadata())

    const run = ledger.finishRun({
      outcome: 'infrastructure_error',
      finishedAt: 1_792_000_004_000,
    })

    expect(run.attempts).toHaveLength(1)
    expect(run.usageComplete).toBe(false)
    expect(run.totalCost).toBeNull()
    expect(run.success).toBe(false)
  })

  it('keeps child request ownership attached to its run and attempt metadata', () => {
    const ledger = createLedger(descriptor({ runId: 'parent-run' }), prices)
    const metadata = attemptMetadata({
      agentId: 'child-agent-2',
      sessionId: 'child-session-2',
      purpose: 'delegated-analysis',
    })
    const attemptId = ledger.startAttempt(metadata)
    ledger.finishAttempt(attemptId, {
      status: 'success',
      usage: { uncachedInputTokens: 10, cacheReadTokens: 20, outputTokens: 5 },
      finishedAt: 1_792_000_003_000,
    })

    const run = ledger.finishRun({ outcome: 'success', finishedAt: 1_792_000_004_000 })
    expect(run.runId).toBe('parent-run')
    expect(run.attempts[0]).toMatchObject({ metadata })
  })

  it('prices attempts with their own snapshots when a run crosses a rate window', async () => {
    const { priceAt } = await import('../../scripts/evaluation/pricing.js')
    const peak = priceAt(Date.parse('2026-10-14T01:00:00.000Z'))
    const offPeak = priceAt(Date.parse('2026-10-14T04:00:00.000Z'))
    const ledger = createLedger(descriptor(), peak)
    const usage = {
      uncachedInputTokens: 1_000_000,
      cacheReadTokens: 2_000_000,
      outputTokens: 3_000_000,
    }
    const firstId = ledger.startAttempt(
      attemptMetadata({ startedAt: Date.parse('2026-10-14T01:00:00.000Z') }),
    )
    ledger.finishAttempt(firstId, {
      status: 'success',
      usage,
      finishedAt: Date.parse('2026-10-14T01:01:00.000Z'),
    })
    const secondId = ledger.startAttempt(
      attemptMetadata({
        sessionId: 'later-session',
        startedAt: Date.parse('2026-10-14T04:00:00.000Z'),
      }),
    )
    ledger.finishAttempt(secondId, {
      status: 'success',
      usage,
      prices: offPeak,
      finishedAt: Date.parse('2026-10-14T04:01:00.000Z'),
    })

    const run = ledger.finishRun({
      outcome: 'success',
      finishedAt: Date.parse('2026-10-14T04:02:00.000Z'),
    })

    // Peak: $0.30 + $0.012 + $3.60. Off-peak is half that rate.
    expect(run.attempts[0]).toMatchObject({ prices: peak })
    expect(run.attempts[1]).toMatchObject({ prices: offPeak })
    expect(run.totalCost).toBeCloseTo(5.868, 10)
  })
})
