import { describe, expect, it } from 'vitest'
import { recoverRun } from '../../scripts/evaluation/recover.js'
import {
  createLedger,
  type RunDescriptor,
  type RunRecord,
} from '../../scripts/evaluation/ledger.js'
import { prices } from './helpers.js'

const startedAt = 1_792_000_000_000

function runDescriptor(overrides: Partial<RunDescriptor> = {}): RunDescriptor {
  return {
    runId: 'recover-run',
    taskId: 'task-1',
    arm: 'dcp',
    replicate: 1,
    model: 'deepseek-flash',
    provider: 'deepseek',
    startedAt,
    ...overrides,
  }
}

function partialLedger(descriptor = runDescriptor()): RunRecord {
  const ledger = createLedger(descriptor, prices)
  const billedFailure = ledger.startAttempt({
    agentId: 'root-agent',
    sessionId: 'root-session',
    purpose: 'agent-turn',
    startedAt: startedAt + 1_000,
  })
  ledger.finishAttempt(billedFailure, {
    status: 'http_error',
    usage: {
      uncachedInputTokens: 100_000,
      cacheReadTokens: 400_000,
      outputTokens: 20_000,
    },
    finishedAt: startedAt + 2_000,
    error: 'provider error after billing usage',
  })
  ledger.startAttempt({
    agentId: 'child-agent',
    sessionId: 'child-session',
    purpose: 'delegated-analysis',
    startedAt: startedAt + 3_000,
  })
  return ledger.snapshot()
}

describe('partial run recovery', () => {
  it('preserves completed charges and ownership while closing pending attempts as unknown', () => {
    const identity = runDescriptor()
    const partial = partialLedger(identity)
    const original = structuredClone(partial)

    const recovered = recoverRun(partial, identity, startedAt + 10_000)

    expect(partial).toEqual(original)
    expect(recovered).toMatchObject({
      ...identity,
      outcome: 'infrastructure_error',
      success: false,
      finishedAt: startedAt + 10_000,
      usageComplete: false,
      totalCost: null,
      knownCost: expect.closeTo(0.077, 12),
      attempts: [
        {
          status: 'http_error',
          usage: {
            uncachedInputTokens: 100_000,
            cacheReadTokens: 400_000,
            outputTokens: 20_000,
          },
          cost: expect.closeTo(0.077, 12),
          metadata: {
            agentId: 'root-agent',
            sessionId: 'root-session',
            purpose: 'agent-turn',
          },
        },
        {
          status: 'aborted',
          usage: null,
          cost: null,
          finishedAt: startedAt + 10_000,
          metadata: {
            agentId: 'child-agent',
            sessionId: 'child-session',
            purpose: 'delegated-analysis',
          },
        },
      ],
    })
    expect(recovered.usageTotals).toMatchObject({
      uncachedInputTokens: 100_000,
      cacheReadTokens: 400_000,
      outputTokens: 20_000,
    })
    expect(recovered.attempts[1]?.error).toBeTruthy()
  })

  it('creates an infrastructure record when the partial ledger is missing', () => {
    const identity = runDescriptor({ runId: 'missing-ledger-run', taskId: 'task-missing' })

    const recovered = recoverRun(null, identity, startedAt + 5_000)

    expect(recovered).toMatchObject({
      ...identity,
      outcome: 'infrastructure_error',
      success: false,
      finishedAt: startedAt + 5_000,
      attempts: [],
      usageComplete: false,
      knownCost: 0,
      totalCost: null,
    })
  })

  it.each([
    ['taskId', { taskId: 'other-task' }],
    ['arm', { arm: 'baseline' }],
    ['replicate', { replicate: 2 }],
  ] as const)('rejects partial ledger identity mismatch on %s', (_field, changed) => {
    const partial = partialLedger()

    expect(() => recoverRun(partial, runDescriptor(changed), startedAt + 10_000)).toThrow(
      /identity|descriptor|mismatch/i,
    )
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid recovery finish time %s',
    (finishedAt) => {
      expect(() => recoverRun(null, runDescriptor(), finishedAt)).toThrow()
    },
  )
})
