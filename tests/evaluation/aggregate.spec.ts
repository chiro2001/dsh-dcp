import { describe, expect, it } from 'vitest'
import { aggregate } from '../../scripts/evaluation/aggregate.js'
import { createLedger } from '../../scripts/evaluation/ledger.js'
import { attemptMetadata, descriptor, prices } from './helpers.js'

function finishedRun({
  runId,
  taskId = 'task-1',
  arm = 'candidate',
  replicate = 1,
  outcome,
  usage,
  status = 'success',
}: {
  runId: string
  taskId?: string
  arm?: string
  replicate?: number
  outcome: 'success' | 'failure' | 'infrastructure_error' | 'budget_exceeded'
  usage?: {
    uncachedInputTokens: number
    cacheReadTokens: number
    outputTokens: number
    reasoningTokens?: number
  }
  status?:
    | 'success'
    | 'http_error'
    | 'network_error'
    | 'invalid_response'
    | 'aborted'
    | 'budget_exceeded'
}) {
  const ledger = createLedger(descriptor({ runId, taskId, arm, replicate }), prices)
  const attemptId = ledger.startAttempt(attemptMetadata({ sessionId: `session-${runId}` }))
  ledger.finishAttempt(attemptId, {
    status,
    ...(usage ? { usage } : {}),
    finishedAt: 1_792_000_003_000,
  })
  return ledger.finishRun({
    outcome,
    finishedAt: 1_792_000_004_000,
  })
}

describe('evaluation run aggregation', () => {
  it('counts all failed-run charges in K while Q uses every planned run', () => {
    const successful = finishedRun({
      runId: 'candidate-task-1-r1',
      outcome: 'success',
      usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 100_000 },
    })
    const failed = finishedRun({
      runId: 'candidate-task-2-r1',
      taskId: 'task-2',
      outcome: 'failure',
      status: 'http_error',
      usage: { uncachedInputTokens: 100_000, cacheReadTokens: 400_000, outputTokens: 20_000 },
    })

    const result = aggregate([successful, failed])

    expect(result.runCount).toBe(2)
    expect(result.successCount).toBe(1)
    expect(result.quality).toBe(0.5)
    expect(result.knownCost).toBeCloseTo(0.457, 12)
    expect(result.totalCost).toBeCloseTo(0.457, 12)
    expect(result.costPerSuccess).toBeCloseTo(0.457, 12)
    expect(result.usageComplete).toBe(true)
  })

  it('reports K as JSON-safe null with a reason when no run succeeds', () => {
    const failed = finishedRun({
      runId: 'only-failure',
      outcome: 'budget_exceeded',
      status: 'budget_exceeded',
      usage: { uncachedInputTokens: 10_000, cacheReadTokens: 0, outputTokens: 1_000 },
    })

    const result = aggregate([failed])
    const serialized = JSON.stringify(result)

    expect(result.runCount).toBe(1)
    expect(result.successCount).toBe(0)
    expect(result.quality).toBe(0)
    expect(result.costPerSuccess).toBeNull()
    expect(result.unavailableReason).toBe('no_success')
    expect(serialized).not.toContain('Infinity')
    expect(serialized).not.toContain('NaN')
  })

  it('retains runs in Q when usage is missing and marks the aggregate cost unknown', () => {
    const success = finishedRun({
      runId: 'known-success',
      outcome: 'success',
      usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 100_000 },
    })
    const unknown = finishedRun({
      runId: 'unknown-failure',
      taskId: 'task-2',
      outcome: 'infrastructure_error',
      status: 'network_error',
    })

    const result = aggregate([success, unknown])

    expect(result.runCount).toBe(2)
    expect(result.successCount).toBe(1)
    expect(result.quality).toBe(0.5)
    expect(result.usageComplete).toBe(false)
    expect(result.knownCost).toBeCloseTo(0.38, 12)
    expect(result.totalCost).toBeNull()
    expect(result.costPerSuccess).toBeNull()
    expect(result.unavailableReason).toBe('unknown_cost')
  })

  it('keeps paired task runs under their own arms and does not merge their costs', () => {
    const baseline = finishedRun({
      runId: 'task-1-baseline-r1',
      arm: 'baseline',
      outcome: 'success',
      usage: { uncachedInputTokens: 100_000, cacheReadTokens: 0, outputTokens: 10_000 },
    })
    const candidate = finishedRun({
      runId: 'task-1-candidate-r1',
      arm: 'candidate',
      outcome: 'success',
      usage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 100_000 },
    })

    const result = aggregate([baseline, candidate])

    expect(result.byArm.baseline).toMatchObject({
      runIds: ['task-1-baseline-r1'],
      runCount: 1,
      successCount: 1,
      totalCost: expect.closeTo(0.038),
    })
    expect(result.byArm.candidate).toMatchObject({
      runIds: ['task-1-candidate-r1'],
      runCount: 1,
      successCount: 1,
      totalCost: expect.closeTo(0.38),
    })
    expect(result.byArm.baseline.costPerSuccess).toBeCloseTo(0.038, 12)
    expect(result.byArm.candidate.costPerSuccess).toBeCloseTo(0.38, 12)
    expect(baseline).toMatchObject({ taskId: 'task-1', replicate: 1, arm: 'baseline' })
    expect(candidate).toMatchObject({ taskId: 'task-1', replicate: 1, arm: 'candidate' })
  })

  it('keeps each run visible when an arm has no successful tasks', () => {
    const records = [
      finishedRun({
        runId: 'baseline-failure-r1',
        arm: 'baseline',
        outcome: 'failure',
        usage: { uncachedInputTokens: 1, cacheReadTokens: 0, outputTokens: 1 },
      }),
      finishedRun({
        runId: 'candidate-success-r1',
        arm: 'candidate',
        outcome: 'success',
        usage: { uncachedInputTokens: 10, cacheReadTokens: 0, outputTokens: 1 },
      }),
    ]

    const result = aggregate(records)

    expect(result.byArm.baseline.runCount).toBe(1)
    expect(result.byArm.baseline.successCount).toBe(0)
    expect(result.byArm.baseline.costPerSuccess).toBeNull()
    expect(result.byArm.baseline.unavailableReason).toBe('no_success')
    expect(result.byArm.candidate.runCount).toBe(1)
    expect(result.byArm.candidate.successCount).toBe(1)
  })
})
