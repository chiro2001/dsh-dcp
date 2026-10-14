export const prices = {
  currency: 'USD' as const,
  source: 'fixed evaluation fixture',
  date: '2026-10-14',
  rates: {
    uncachedInputPerMillion: 0.27,
    cacheReadPerMillion: 0.07,
    outputPerMillion: 1.1,
  },
}

export function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    arm: 'candidate',
    replicate: 1,
    model: 'deepseek-flash',
    provider: 'deepseek',
    startedAt: 1_792_000_000_000,
    ...overrides,
  }
}

export function attemptMetadata(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'root-agent',
    sessionId: 'root-session',
    purpose: 'agent-turn',
    startedAt: 1_792_000_001_000,
    ...overrides,
  }
}

export const completeUsage = {
  uncachedInputTokens: 1_250_000,
  cacheReadTokens: 2_000_000,
  outputTokens: 300_000,
  reasoningTokens: 120_000,
}
