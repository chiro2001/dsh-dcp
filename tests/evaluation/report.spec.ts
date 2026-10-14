import { describe, expect, it } from 'vitest'
import { compareArms, finalizeVerification } from '../../scripts/evaluation/report.js'
import {
  createLedger,
  type AttemptStatus,
  type PriceSnapshot,
  type RunOutcome,
  type Usage,
} from '../../scripts/evaluation/ledger.js'
import { priceAt } from '../../scripts/evaluation/pricing.js'
import { descriptor, prices } from './helpers.js'

const startAt = Date.parse('2026-10-14T00:00:00.000Z')

type RunInput = {
  runId: string
  taskId: string
  arm: 'baseline' | 'dcp'
  replicate?: number
  outcome: RunOutcome
  status?: AttemptStatus
  usage?: Usage
  includeAttempt?: boolean
  price?: PriceSnapshot
  externalCost?: number
}

function record(input: RunInput) {
  const runStart =
    startAt + Math.max(0, Number.parseInt(input.runId.replace(/\D/g, '') || '0', 10))
  const ledger = createLedger(
    descriptor({
      runId: input.runId,
      taskId: input.taskId,
      arm: input.arm,
      replicate: input.replicate ?? 1,
      model: 'deepseek-flash',
      provider: 'deepseek',
      startedAt: runStart,
    }),
    input.price ?? prices,
  )
  if (input.includeAttempt !== false) {
    const attemptId = ledger.startAttempt({
      agentId: `agent-${input.runId}`,
      sessionId: `session-${input.runId}`,
      purpose: 'agent-turn',
      startedAt: runStart + 1,
    })
    ledger.finishAttempt(attemptId, {
      status:
        input.status ??
        (input.outcome === 'success'
          ? 'success'
          : input.outcome === 'budget_exceeded'
            ? 'budget_exceeded'
            : 'http_error'),
      finishedAt: runStart + 2,
      ...(input.usage === undefined ? {} : { usage: input.usage }),
    })
  }
  return ledger.finishRun({
    outcome: input.outcome,
    finishedAt: runStart + 3,
    externalCost: input.externalCost,
  })
}

const knownUsage: Usage = {
  uncachedInputTokens: 100_000,
  cacheReadTokens: 0,
  outputTokens: 10_000,
}

describe('evaluation report and independent verification', () => {
  it('marks success only after a qualifying verifier result and returns a detached record', () => {
    const unverified = record({
      runId: 'run-1',
      taskId: 'task-1',
      arm: 'dcp',
      outcome: 'failure',
      usage: knownUsage,
    })

    const verified = finalizeVerification(unverified, {
      reward: 1,
      exception: false,
      executionStatus: 'completed',
    })

    expect(unverified).toMatchObject({ outcome: 'failure', success: false })
    expect(verified).toMatchObject({ outcome: 'success', success: true })
    expect(verified).not.toBe(unverified)
    expect(verified.attempts).toEqual(unverified.attempts)
    expect(verified.totalCost).toBe(unverified.totalCost)
    expect(verified.knownCost).toBe(unverified.knownCost)
  })

  it('keeps budget, exception, missing reward, and failed execution from becoming success', () => {
    const source = record({
      runId: 'run-2',
      taskId: 'task-2',
      arm: 'dcp',
      outcome: 'failure',
      usage: knownUsage,
    })
    const base = { reward: 1, exception: false } as const

    const budget = finalizeVerification(source, {
      ...base,
      executionStatus: 'budget_exceeded',
    })
    const exception = finalizeVerification(source, {
      ...base,
      exception: true,
      executionStatus: 'completed',
    })
    const ungraded = finalizeVerification(source, {
      reward: null,
      exception: false,
      executionStatus: 'completed',
    })
    const executionError = finalizeVerification(source, {
      ...base,
      executionStatus: 'error',
    })
    const nearOne = finalizeVerification(source, {
      reward: 0.999,
      exception: false,
      executionStatus: 'completed',
    })

    expect(budget).toMatchObject({ outcome: 'budget_exceeded', success: false })
    expect(exception).toMatchObject({ outcome: 'failure', success: false })
    expect(ungraded).toMatchObject({ outcome: 'failure', success: false })
    expect(executionError).toMatchObject({ outcome: 'infrastructure_error', success: false })
    expect(nearOne).toMatchObject({ outcome: 'failure', success: false })
    for (const result of [budget, exception, ungraded, executionError, nearOne]) {
      expect(result.totalCost).toBe(source.totalCost)
      expect(result.knownCost).toBe(source.knownCost)
    }
  })

  it('does not let a perfect external reward succeed a run with no model attempts', () => {
    const noRequest = record({
      runId: 'run-3',
      taskId: 'task-3',
      arm: 'baseline',
      outcome: 'failure',
      includeAttempt: false,
    })

    const result = finalizeVerification(noRequest, {
      reward: 1,
      exception: false,
      executionStatus: 'completed',
    })

    expect(result).toMatchObject({ outcome: 'failure', success: false, attempts: [] })
    expect(result.totalCost).toBeNull()
  })

  it('rejects non-finite or out-of-range verifier rewards', () => {
    const source = record({
      runId: 'run-4',
      taskId: 'task-4',
      arm: 'baseline',
      outcome: 'failure',
      usage: knownUsage,
    })

    for (const reward of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
      expect(() =>
        finalizeVerification(source, {
          reward,
          exception: false,
          executionStatus: 'completed',
        }),
      ).toThrow()
    }
  })

  it('computes K and S from every paired run, including billed failures and budget stops', () => {
    const baseline = [
      record({
        runId: 'baseline-1',
        taskId: 'task-1',
        arm: 'baseline',
        outcome: 'success',
        usage: knownUsage,
      }),
      record({
        runId: 'baseline-2',
        taskId: 'task-2',
        arm: 'baseline',
        outcome: 'failure',
        status: 'http_error',
        usage: knownUsage,
      }),
      record({
        runId: 'baseline-3',
        taskId: 'task-3',
        arm: 'baseline',
        outcome: 'budget_exceeded',
        status: 'budget_exceeded',
        usage: { uncachedInputTokens: 50_000, cacheReadTokens: 0, outputTokens: 5_000 },
      }),
    ]
    const candidate = [
      record({
        runId: 'dcp-1',
        taskId: 'task-1',
        arm: 'dcp',
        outcome: 'success',
        usage: { uncachedInputTokens: 50_000, cacheReadTokens: 0, outputTokens: 5_000 },
      }),
      record({
        runId: 'dcp-2',
        taskId: 'task-2',
        arm: 'dcp',
        outcome: 'failure',
        status: 'http_error',
        usage: { uncachedInputTokens: 50_000, cacheReadTokens: 0, outputTokens: 5_000 },
      }),
      record({
        runId: 'dcp-3',
        taskId: 'task-3',
        arm: 'dcp',
        outcome: 'budget_exceeded',
        status: 'budget_exceeded',
        usage: { uncachedInputTokens: 50_000, cacheReadTokens: 0, outputTokens: 5_000 },
      }),
    ]

    const result = compareArms([...baseline, ...candidate])

    expect(result.pairedTaskCount).toBe(3)
    expect(result.baseline).toMatchObject({ runCount: 3, successCount: 1, quality: 1 / 3 })
    expect(result.candidate).toMatchObject({ runCount: 3, successCount: 1, quality: 1 / 3 })
    expect(result.baseline.knownCost).toBeCloseTo(0.095, 12)
    expect(result.candidate.knownCost).toBeCloseTo(0.057, 12)
    expect(result.baseline.costPerSuccess).toBeCloseTo(0.095, 12)
    expect(result.candidate.costPerSuccess).toBeCloseTo(0.057, 12)
    expect(result.effectiveSavingsRate).toBeCloseTo(0.4, 12)
    expect(result.unavailableReason).toBeNull()
    expect(result.costSavingsInterval).toBeNull()
    expect(result.intervalUnavailableReason).toBe('bootstrap_no_success')
  })

  it('keeps unknown-cost runs in Q and makes both raw and normalized cost claims unavailable', () => {
    const baseline = [
      record({
        runId: 'baseline-known',
        taskId: 'task-1',
        arm: 'baseline',
        outcome: 'success',
        usage: knownUsage,
      }),
      record({
        runId: 'baseline-unknown',
        taskId: 'task-2',
        arm: 'baseline',
        outcome: 'failure',
        status: 'network_error',
      }),
    ]
    const candidate = [
      record({
        runId: 'dcp-known',
        taskId: 'task-1',
        arm: 'dcp',
        outcome: 'success',
        usage: knownUsage,
      }),
      record({
        runId: 'dcp-unknown',
        taskId: 'task-2',
        arm: 'dcp',
        outcome: 'failure',
        status: 'network_error',
      }),
    ]

    const result = compareArms([...baseline, ...candidate])

    expect(result.baseline).toMatchObject({ runCount: 2, successCount: 1, quality: 0.5 })
    expect(result.candidate).toMatchObject({ runCount: 2, successCount: 1, quality: 0.5 })
    expect(result.baseline.totalCost).toBeNull()
    expect(result.candidate.totalCost).toBeNull()
    expect(result.effectiveSavingsRate).toBeNull()
    expect(result.normalizedPeakSavingsRate).toBeNull()
    expect(result.unavailableReason).toBe('unknown_cost')
    expect(result.costSavingsInterval).toBeNull()
    expect(result.intervalUnavailableReason).toBe('unknown_cost')
  })

  it('rejects paired savings when task/replicate sets differ without deleting one-sided failures', () => {
    const records = [
      record({
        runId: 'baseline-task-1',
        taskId: 'task-1',
        arm: 'baseline',
        outcome: 'success',
        usage: knownUsage,
      }),
      record({
        runId: 'baseline-task-2',
        taskId: 'task-2',
        arm: 'baseline',
        outcome: 'failure',
        usage: knownUsage,
      }),
      record({
        runId: 'dcp-task-1',
        taskId: 'task-1',
        arm: 'dcp',
        outcome: 'success',
        usage: { uncachedInputTokens: 50_000, cacheReadTokens: 0, outputTokens: 5_000 },
      }),
    ]

    const result = compareArms(records)

    expect(result.baseline).toMatchObject({ runCount: 2, successCount: 1 })
    expect(result.candidate).toMatchObject({ runCount: 1, successCount: 1 })
    expect(result.pairedTaskCount).toBe(1)
    expect(result.effectiveSavingsRate).toBeNull()
    expect(result.unavailableReason).toBe('unmatched_pairs')
    expect(result.qualityDifference).toBeNull()
    expect(result.qualityLowerBound).toBeNull()
    expect(result.costSavingsInterval).toBeNull()
  })

  it('requires matching replicate IDs even when both arms have the same task and run counts', () => {
    const records = [
      record({
        runId: 'baseline-rep-1',
        taskId: 'same-task',
        arm: 'baseline',
        replicate: 1,
        outcome: 'success',
        usage: knownUsage,
      }),
      record({
        runId: 'baseline-rep-2',
        taskId: 'same-task',
        arm: 'baseline',
        replicate: 2,
        outcome: 'failure',
        usage: knownUsage,
      }),
      record({
        runId: 'dcp-rep-1',
        taskId: 'same-task',
        arm: 'dcp',
        replicate: 1,
        outcome: 'success',
        usage: knownUsage,
      }),
      record({
        runId: 'dcp-rep-3',
        taskId: 'same-task',
        arm: 'dcp',
        replicate: 3,
        outcome: 'success',
        usage: knownUsage,
      }),
    ]

    const result = compareArms(records)

    expect(result.baseline.runCount).toBe(2)
    expect(result.candidate.runCount).toBe(2)
    expect(result.pairedTaskCount).toBe(1)
    expect(result.effectiveSavingsRate).toBeNull()
    expect(result.unavailableReason).toBe('unmatched_pairs')
    expect(result.qualityDifference).toBeNull()
  })

  it('normalizes different provider price windows to peak without billing reasoning twice', () => {
    const peak = priceAt(Date.parse('2026-10-14T01:00:00.000Z'))
    const offPeak = priceAt(Date.parse('2026-10-14T04:00:00.000Z'))
    const sharedUsage: Usage = {
      uncachedInputTokens: 1_000_000,
      cacheReadTokens: 0,
      outputTokens: 100_000,
    }
    const baseline = record({
      runId: 'peak-baseline',
      taskId: 'same-task',
      arm: 'baseline',
      outcome: 'success',
      usage: { ...sharedUsage, reasoningTokens: 100_000 },
      price: peak,
      externalCost: 0.04,
    })
    const candidate = record({
      runId: 'offpeak-dcp',
      taskId: 'same-task',
      arm: 'dcp',
      outcome: 'success',
      usage: { ...sharedUsage, reasoningTokens: 0 },
      price: offPeak,
      externalCost: 0.02,
    })

    const result = compareArms([baseline, candidate])

    expect(result.baseline.totalCost).toBeCloseTo(0.46, 12)
    expect(result.candidate.totalCost).toBeCloseTo(0.23, 12)
    expect(result.effectiveSavingsRate).toBeCloseTo(0.5, 12)
    expect(result.normalizedPeakSavingsRate).toBeCloseTo(1 - 0.44 / 0.46, 12)
    expect(result.costSavingsInterval).toEqual([0.5, 0.5])
    expect(result.intervalUnavailableReason).toBeNull()
  })

  it('uses distinct task clusters, not repeated runs, for the conservative quality bound', () => {
    const records = Array.from({ length: 10 }, (_, taskIndex) => {
      const taskId = `cluster-${taskIndex}`
      return Array.from({ length: 5 }, (_replicate, replicateIndex) => {
        const replicate = replicateIndex + 1
        return [
          record({
            runId: `baseline-${taskIndex}-${replicate}`,
            taskId,
            arm: 'baseline',
            replicate,
            outcome: 'success',
            usage: knownUsage,
          }),
          record({
            runId: `dcp-${taskIndex}-${replicate}`,
            taskId,
            arm: 'dcp',
            replicate,
            outcome: 'success',
            usage: { uncachedInputTokens: 50_000, cacheReadTokens: 0, outputTokens: 5_000 },
          }),
        ]
      })
    }).flat(2)

    const first = compareArms(records)
    const second = compareArms(records)
    const expectedBound = -Math.sqrt((2 * Math.log(20)) / 10)

    expect(first.pairedTaskCount).toBe(10)
    expect(first.qualityDifference).toBe(0)
    expect(first.qualityLowerBound).toBeCloseTo(expectedBound, 12)
    expect(first.qualityLowerBound).toBeLessThan(0)
    expect(first.effectiveSavingsRate).toBeCloseTo(0.5, 12)
    expect(first.costSavingsInterval).toEqual([0.5, 0.5])
    expect(second.costSavingsInterval).toEqual(first.costSavingsInterval)
  })

  it('rejects duplicate task-arm-replicate records rather than resampling them as independent runs', () => {
    const baseline = record({
      runId: 'baseline-original',
      taskId: 'task-duplicate',
      arm: 'baseline',
      outcome: 'success',
      usage: knownUsage,
    })
    const duplicate = record({
      runId: 'baseline-copy',
      taskId: 'task-duplicate',
      arm: 'baseline',
      outcome: 'success',
      usage: knownUsage,
    })
    const candidate = record({
      runId: 'dcp-original',
      taskId: 'task-duplicate',
      arm: 'dcp',
      outcome: 'success',
      usage: knownUsage,
    })

    expect(() => compareArms([baseline, duplicate, candidate])).toThrow(/duplicate/i)
  })

  it('reports no_success before cost availability and no_runs for an empty input', () => {
    const failedBaseline = record({
      runId: 'failed-baseline',
      taskId: 'task-no-success',
      arm: 'baseline',
      outcome: 'failure',
      usage: knownUsage,
    })
    const successfulCandidate = record({
      runId: 'successful-dcp',
      taskId: 'task-no-success',
      arm: 'dcp',
      outcome: 'success',
      usage: knownUsage,
    })

    const noBaselineSuccess = compareArms([failedBaseline, successfulCandidate])
    const noRuns = compareArms([])

    expect(noBaselineSuccess.effectiveSavingsRate).toBeNull()
    expect(noBaselineSuccess.unavailableReason).toBe('no_success')
    expect(noBaselineSuccess.baseline.costPerSuccess).toBeNull()
    expect(noRuns.pairedTaskCount).toBe(0)
    expect(noRuns.unavailableReason).toBe('no_runs')
    expect(noRuns.baseline.runCount).toBe(0)
    expect(noRuns.candidate.runCount).toBe(0)
  })
})
