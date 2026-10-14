/** Attempt-level, JSON-safe accounting. Missing provider usage never means free. */
export interface PriceSnapshot {
  currency: 'USD'
  date: string
  source: string
  rates: {
    uncachedInputPerMillion: number
    cacheReadPerMillion: number
    outputPerMillion: number
  }
  model?: string
  window?: 'peak' | 'off-peak'
  retrievedAt?: string
}

export interface RunDescriptor {
  runId: string
  taskId: string
  arm: string
  replicate: number
  model: string
  provider: string
  startedAt: number
}

export interface AttemptMetadata {
  agentId: string
  sessionId: string
  purpose: string
  startedAt: number
  turn?: number
  step?: number
  requestHash?: string
  messageCount?: number
  toolNames?: string[]
}

export interface Usage {
  uncachedInputTokens: number
  cacheReadTokens: number
  outputTokens: number
  reasoningTokens?: number
}

export type AttemptStatus =
  | 'success'
  | 'http_error'
  | 'network_error'
  | 'invalid_response'
  | 'aborted'
  | 'budget_exceeded'

export type RunOutcome = 'success' | 'failure' | 'infrastructure_error' | 'budget_exceeded'

export interface AttemptRecord {
  attemptId: string
  metadata: AttemptMetadata
  status: AttemptStatus | 'pending'
  finishedAt: number | null
  usage: Usage | null
  prices: PriceSnapshot
  cost: number | null
  error?: string
}

export interface RunRecord extends RunDescriptor {
  version: 1
  attempts: AttemptRecord[]
  outcome: RunOutcome | null
  success: boolean
  finishedAt: number | null
  externalCost: number
  usageComplete: boolean
  usageTotals: Required<Usage>
  knownCost: number
  totalCost: number | null
}

function nonnegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`)
}

export function validateUsage(usage: Usage): void {
  for (const field of ['uncachedInputTokens', 'cacheReadTokens', 'outputTokens'] as const) {
    if (!Number.isSafeInteger(usage[field]) || usage[field] < 0)
      throw new Error(`Invalid usage.${field}`)
  }
  if (usage.reasoningTokens !== undefined) {
    if (
      !Number.isSafeInteger(usage.reasoningTokens) ||
      usage.reasoningTokens < 0 ||
      usage.reasoningTokens > usage.outputTokens
    )
      throw new Error('Invalid usage.reasoningTokens')
  }
}

function validatePrices(prices: PriceSnapshot): void {
  if (prices.currency !== 'USD' || !prices.date || !prices.source)
    throw new Error('Invalid price snapshot provenance')
  for (const [field, value] of Object.entries(prices.rates)) nonnegativeFinite(value, field)
  for (const field of [
    'uncachedInputPerMillion',
    'cacheReadPerMillion',
    'outputPerMillion',
  ] as const)
    nonnegativeFinite(prices.rates[field], field)
}

export function costOf(usage: Usage, prices: PriceSnapshot): number {
  validateUsage(usage)
  validatePrices(prices)
  return (
    (usage.uncachedInputTokens * prices.rates.uncachedInputPerMillion +
      usage.cacheReadTokens * prices.rates.cacheReadPerMillion +
      usage.outputTokens * prices.rates.outputPerMillion) /
    1_000_000
  )
}

export interface FinishAttempt {
  status: AttemptStatus
  finishedAt: number
  usage?: Usage
  prices?: PriceSnapshot
  error?: string
}

export function createLedger(descriptor: RunDescriptor, defaultPrices: PriceSnapshot) {
  validatePrices(defaultPrices)
  nonnegativeFinite(descriptor.startedAt, 'startedAt')
  if (
    !descriptor.runId ||
    !descriptor.taskId ||
    !descriptor.arm ||
    !descriptor.model ||
    !descriptor.provider ||
    !Number.isSafeInteger(descriptor.replicate) ||
    descriptor.replicate < 0
  )
    throw new Error('Invalid run descriptor')
  const identity = structuredClone(descriptor)
  const prices = structuredClone(defaultPrices)
  const attempts: AttemptRecord[] = []
  let outcome: RunOutcome | null = null
  let finishedAt: number | null = null
  let externalCost = 0
  const requireOpen = () => {
    if (outcome !== null) throw new Error('Run already finalized')
  }

  const snapshot = (): RunRecord => {
    const usageTotals: Required<Usage> = {
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    }
    for (const attempt of attempts) {
      if (!attempt.usage) continue
      for (const field of Object.keys(usageTotals) as Array<keyof Required<Usage>>)
        usageTotals[field] += attempt.usage[field] ?? 0
    }
    const usageComplete =
      attempts.length > 0 && attempts.every((attempt) => attempt.cost !== null)
    const knownCost =
      externalCost + attempts.reduce((sum, attempt) => sum + (attempt.cost ?? 0), 0)
    return structuredClone({
      ...identity,
      version: 1 as const,
      attempts,
      outcome,
      success: outcome === 'success',
      finishedAt,
      externalCost,
      usageComplete,
      usageTotals,
      knownCost,
      totalCost: usageComplete ? knownCost : null,
    })
  }

  return {
    startAttempt(metadata: AttemptMetadata): string {
      requireOpen()
      if (!metadata.agentId || !metadata.sessionId || !metadata.purpose)
        throw new Error('Missing request ownership')
      nonnegativeFinite(metadata.startedAt, 'attempt.startedAt')
      const attemptId = `${identity.runId}:${attempts.length + 1}`
      attempts.push({
        attemptId,
        metadata: structuredClone(metadata),
        prices: structuredClone(prices),
        status: 'pending',
        finishedAt: null,
        usage: null,
        cost: null,
      })
      return attemptId
    },
    finishAttempt(attemptId: string, result: FinishAttempt): void {
      requireOpen()
      const attempt = attempts.find((item) => item.attemptId === attemptId)
      if (!attempt || attempt.status !== 'pending')
        throw new Error('Unknown or already finalized attempt')
      if (
        ![
          'success',
          'http_error',
          'network_error',
          'invalid_response',
          'aborted',
          'budget_exceeded',
        ].includes(result.status)
      )
        throw new Error('Invalid attempt status')
      nonnegativeFinite(result.finishedAt, 'attempt.finishedAt')
      if (result.finishedAt < attempt.metadata.startedAt)
        throw new Error('Attempt finished before it started')
      const chosenPrices = result.prices ?? attempt.prices
      validatePrices(chosenPrices)
      const cost = result.usage === undefined ? null : costOf(result.usage, chosenPrices)
      Object.assign(attempt, {
        status: result.status,
        finishedAt: result.finishedAt,
        prices: structuredClone(chosenPrices),
        usage: result.usage === undefined ? null : structuredClone(result.usage),
        cost,
        ...(result.error === undefined ? {} : { error: result.error }),
      })
    },
    finishRun(result: {
      outcome: RunOutcome
      finishedAt: number
      externalCost?: number
    }): RunRecord {
      requireOpen()
      if (
        !['success', 'failure', 'infrastructure_error', 'budget_exceeded'].includes(
          result.outcome,
        )
      )
        throw new Error('Invalid run outcome')
      nonnegativeFinite(result.finishedAt, 'run.finishedAt')
      nonnegativeFinite(result.externalCost ?? 0, 'externalCost')
      if (result.outcome === 'success' && attempts.length === 0)
        throw new Error('A run with no model requests cannot be successful')
      for (const attempt of attempts) {
        if (attempt.status !== 'pending') continue
        attempt.status = 'aborted'
        attempt.finishedAt = result.finishedAt
        attempt.error = 'Run ended before request usage was recorded'
      }
      outcome = result.outcome
      finishedAt = result.finishedAt
      externalCost = result.externalCost ?? 0
      return snapshot()
    },
    snapshot,
  }
}

export type Ledger = ReturnType<typeof createLedger>
