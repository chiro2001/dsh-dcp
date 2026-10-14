import type { RunRecord } from './ledger.js'

export interface ArmSummary {
  runIds: string[]
  runCount: number
  successCount: number
  quality: number | null
  knownCost: number
  totalCost: number | null
  usageComplete: boolean
  costPerSuccess: number | null
  unavailableReason: 'no_runs' | 'no_success' | 'unknown_cost' | null
}

function summarize(records: readonly RunRecord[]): ArmSummary {
  const runCount = records.length
  const successCount = records.filter((run) => run.success).length
  const usageComplete = runCount > 0 && records.every((run) => run.totalCost !== null)
  const knownCost = records.reduce((sum, run) => sum + run.knownCost, 0)
  const unavailableReason =
    runCount === 0
      ? 'no_runs'
      : successCount === 0
        ? 'no_success'
        : !usageComplete
          ? 'unknown_cost'
          : null
  return {
    runIds: records.map((run) => run.runId),
    runCount,
    successCount,
    quality: runCount === 0 ? null : successCount / runCount,
    knownCost,
    totalCost: usageComplete ? knownCost : null,
    usageComplete,
    costPerSuccess: unavailableReason === null ? knownCost / successCount : null,
    unavailableReason,
  }
}

export function aggregate(records: readonly RunRecord[]) {
  const seenRuns = new Set<string>()
  const seenPairs = new Set<string>()
  const arms: Record<string, RunRecord[]> = Object.create(null)
  for (const run of records) {
    if (run.outcome === null || run.finishedAt === null)
      throw new Error('Cannot aggregate an unfinished run')
    const pair = JSON.stringify([run.taskId, run.arm, run.replicate])
    if (seenRuns.has(run.runId) || seenPairs.has(pair))
      throw new Error('Duplicate run or task/arm/replicate identity')
    seenRuns.add(run.runId)
    seenPairs.add(pair)
    ;(arms[run.arm] ??= []).push(run)
  }
  return {
    ...summarize(records),
    byArm: Object.fromEntries(
      Object.entries(arms).map(([arm, runs]) => [arm, summarize(runs)]),
    ),
  }
}
