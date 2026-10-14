import { aggregate, type ArmSummary } from './aggregate.js'
import { costOf, type RunRecord } from './ledger.js'
import { priceAt } from './pricing.js'

/** Independent benchmark verification grants success; model prose never does. */
export function finalizeVerification(
  record: RunRecord,
  verification: {
    reward: number | null
    exception: boolean
    executionStatus: 'completed' | 'budget_exceeded' | 'error'
  },
): RunRecord {
  const { reward, exception, executionStatus } = verification
  if (reward !== null && (!Number.isFinite(reward) || reward < 0 || reward > 1))
    throw new Error('Invalid verifier reward')
  const success =
    reward === 1 && !exception && executionStatus === 'completed' && record.attempts.length > 0
  return structuredClone({
    ...record,
    success,
    outcome: success
      ? 'success'
      : executionStatus === 'budget_exceeded'
        ? 'budget_exceeded'
        : executionStatus === 'error'
          ? 'infrastructure_error'
          : 'failure',
  })
}

interface Cluster {
  taskId: string
  baseline: RunRecord[]
  candidate: RunRecord[]
}

function emptySummary(): ArmSummary {
  return aggregate([])
}

function savings(base: ArmSummary, candidate: ArmSummary): number | null {
  if (
    base.costPerSuccess === null ||
    candidate.costPerSuccess === null ||
    base.costPerSuccess <= 0
  )
    return null
  return 1 - candidate.costPerSuccess / base.costPerSuccess
}

function normalized(records: RunRecord[]): ArmSummary {
  const peak = priceAt(Date.parse('2026-10-14T06:00:00Z'))
  return aggregate(
    records.map((record) => {
      const costs = record.attempts.map((attempt) =>
        attempt.usage ? costOf(attempt.usage, peak) : null,
      )
      const complete = record.usageComplete && costs.every((cost) => cost !== null)
      const knownCost =
        record.externalCost + costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
      return { ...record, knownCost, totalCost: complete ? knownCost : null }
    }),
  )
}

function bootstrap(clusters: Cluster[]): {
  interval: [number, number] | null
  reason: string | null
} {
  // Reproducible resampling of whole task clusters, including every repeat and failure.
  let state = 0x6d2b79f5
  const random = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
  const values: number[] = []
  for (let draw = 0; draw < 1000; draw++) {
    let baseCost = 0
    let candidateCost = 0
    let baseSuccess = 0
    let candidateSuccess = 0
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[Math.floor(random() * clusters.length)]!
      for (const run of cluster.baseline) {
        if (run.totalCost === null) return { interval: null, reason: 'unknown_cost' }
        baseCost += run.totalCost
        baseSuccess += Number(run.success)
      }
      for (const run of cluster.candidate) {
        if (run.totalCost === null) return { interval: null, reason: 'unknown_cost' }
        candidateCost += run.totalCost
        candidateSuccess += Number(run.success)
      }
    }
    if (baseSuccess === 0 || candidateSuccess === 0)
      return { interval: null, reason: 'bootstrap_no_success' }
    if (baseCost <= 0) return { interval: null, reason: 'zero_baseline_cost' }
    values.push(1 - candidateCost / candidateSuccess / (baseCost / baseSuccess))
  }
  values.sort((a, b) => a - b)
  return { interval: [values[24]!, values[974]!], reason: null }
}

export function compareArms(
  records: readonly RunRecord[],
  baselineArm = 'baseline',
  candidateArm = 'dcp',
) {
  if (baselineArm === candidateArm) throw new Error('Comparison requires distinct arms')
  const all = aggregate(records)
  const baseline = all.byArm[baselineArm] ?? emptySummary()
  const candidate = all.byArm[candidateArm] ?? emptySummary()
  const baseRuns = records.filter((record) => record.arm === baselineArm)
  const candidateRuns = records.filter((record) => record.arm === candidateArm)
  const key = (run: RunRecord) => JSON.stringify([run.taskId, run.replicate])
  const baseKeys = new Set(baseRuns.map(key))
  const candidateKeys = new Set(candidateRuns.map(key))
  const matched =
    baseKeys.size === candidateKeys.size && [...baseKeys].every((id) => candidateKeys.has(id))
  const commonTasks = new Set(
    baseRuns.filter((run) => candidateKeys.has(key(run))).map((run) => run.taskId),
  )
  const clusters = [...commonTasks].sort().map((taskId): Cluster => ({
    taskId,
    baseline: baseRuns.filter((run) => run.taskId === taskId),
    candidate: candidateRuns.filter((run) => run.taskId === taskId),
  }))
  const unavailableReason =
    baseRuns.length === 0 && candidateRuns.length === 0
      ? 'no_runs'
      : !matched
        ? 'unmatched_pairs'
        : baseline.successCount === 0 || candidate.successCount === 0
          ? 'no_success'
          : !baseline.usageComplete || !candidate.usageComplete
            ? 'unknown_cost'
            : (baseline.costPerSuccess ?? 0) <= 0
              ? 'zero_baseline_cost'
              : null
  const qualityDifference =
    matched && clusters.length > 0
      ? clusters.reduce(
          (sum, cluster) =>
            sum +
            (cluster.candidate.filter((run) => run.success).length / cluster.candidate.length -
              cluster.baseline.filter((run) => run.success).length / cluster.baseline.length),
          0,
        ) / clusters.length
      : null
  const qualityLowerBound =
    qualityDifference === null
      ? null
      : Math.max(-1, qualityDifference - Math.sqrt((2 * Math.log(20)) / clusters.length))
  const interval =
    unavailableReason === null
      ? bootstrap(clusters)
      : { interval: null, reason: unavailableReason }
  return {
    baseline,
    candidate,
    pairedTaskCount: commonTasks.size,
    effectiveSavingsRate: unavailableReason === null ? savings(baseline, candidate) : null,
    unavailableReason,
    normalizedPeakSavingsRate:
      unavailableReason === null
        ? savings(normalized(baseRuns), normalized(candidateRuns))
        : null,
    qualityDifference,
    qualityLowerBound,
    costSavingsInterval: interval.interval,
    intervalUnavailableReason: interval.reason,
    statisticalMethod: {
      cost: '95% percentile task-cluster bootstrap; 1000 deterministic draws; all failed/unknown runs retained',
      quality:
        'One-sided 95% Hoeffding bound on independent task-cluster paired means; conservative pilot diagnostic',
      scope:
        'Conditional, non-random subset. These intervals do not certify population quality or 1pp non-inferiority.',
    },
  }
}
