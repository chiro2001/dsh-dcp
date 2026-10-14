import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const raw = resolve(
  process.argv[2] ?? 'docs/evaluation-runs/2026-10-14T10-01-50-936Z/raw',
)
const errors = []
const unknown = []
const checked = []
const records = new Map()

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function issue(message) {
  errors.push(message)
}

function compareNumber(actual, expected, label) {
  if (actual === null || expected === null) {
    if (actual !== expected) issue(`${label}: expected ${expected}, got ${actual}`)
    return
  }
  if (
    typeof actual !== 'number' ||
    typeof expected !== 'number' ||
    !Number.isFinite(actual) ||
    !Number.isFinite(expected) ||
    Math.abs(actual - expected) > Math.max(1e-12, Math.abs(expected) * 1e-10)
  )
    issue(`${label}: expected ${expected}, got ${actual}`)
}

function attemptCost(attempt) {
  if (attempt.usage === null) return null
  const rates = attempt.prices?.rates
  if (!rates) throw new Error(`Missing price rates for ${attempt.attemptId}`)
  return (
    (attempt.usage.uncachedInputTokens * rates.uncachedInputPerMillion +
      attempt.usage.cacheReadTokens * rates.cacheReadPerMillion +
      attempt.usage.outputTokens * rates.outputPerMillion) /
    1_000_000
  )
}

function identityKey(record) {
  return JSON.stringify([record.taskId, record.arm, record.replicate])
}

function checkLedgerCost(ledger, label) {
  let attemptTotal = 0
  let complete = ledger.attempts.length > 0
  const usageTotals = {
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  }
  for (const [index, attempt] of ledger.attempts.entries()) {
    const expected = attemptCost(attempt)
    compareNumber(attempt.cost, expected, `${label} attempt ${index + 1} cost`)
    if (expected === null) complete = false
    else attemptTotal += expected
    if (attempt.usage) {
      for (const field of Object.keys(usageTotals))
        usageTotals[field] += attempt.usage[field] ?? 0
    }
  }
  const knownCost = ledger.externalCost + attemptTotal
  compareNumber(ledger.knownCost, knownCost, `${label} knownCost`)
  compareNumber(
    ledger.totalCost,
    complete ? knownCost : null,
    `${label} totalCost completeness`,
  )
  if (!isDeepStrictEqual(ledger.usageTotals, usageTotals))
    issue(`${label} usageTotals do not sum all attempts`)
  if (ledger.usageComplete !== complete)
    issue(`${label} usageComplete disagrees with per-attempt usage`)
  return { attemptTotal, complete }
}

function checkAttemptPreservation(source, graded, label) {
  if (source.attempts.length !== graded.attempts.length) {
    issue(`${label} attempt count changed ${source.attempts.length} -> ${graded.attempts.length}`)
    return
  }
  const sourceCounts = { completed: 0, pending: 0 }
  const gradedCounts = { completed: 0, abortedFromPending: 0, other: 0 }
  for (const [index, original] of source.attempts.entries()) {
    const collected = graded.attempts[index]
    if (!collected) {
      issue(`${label} dropped attempt at index ${index}`)
      continue
    }
    if (original.status === 'pending') {
      sourceCounts.pending++
      if (collected.status === 'aborted') gradedCounts.abortedFromPending++
      else issue(`${label} pending attempt ${original.attemptId} was not recovered as aborted`)
      if (collected.usage !== null || collected.cost !== null)
        issue(`${label} pending attempt ${original.attemptId} gained usage or cost`)
    } else {
      sourceCounts.completed++
      gradedCounts.completed++
      if (collected.status !== original.status)
        issue(`${label} completed attempt ${original.attemptId} status changed`)
    }
    for (const field of ['attemptId', 'metadata', 'prices', 'usage']) {
      if (!isDeepStrictEqual(original[field], collected[field]))
        issue(`${label} attempt ${original.attemptId} changed ${field}`)
    }
    if (original.status !== 'pending')
      compareNumber(
        collected.cost,
        original.cost,
        `${label} preserved attempt ${original.attemptId} cost`,
      )
  }
  if (
    sourceCounts.completed + sourceCounts.pending !==
    gradedCounts.completed + gradedCounts.abortedFromPending
  )
    issue(`${label} completed+pending attempt total was not preserved`)
  return { sourceCounts, gradedCounts }
}

if (!existsSync(raw)) throw new Error(`Raw run directory does not exist: ${raw}`)
const outcomes = readJson(resolve(raw, 'outcomes.json'))
const protocolPath = resolve(raw, 'protocol.json')
const protocol = existsSync(protocolPath) ? readJson(protocolPath) : null
const planned = new Set((protocol?.plan ?? []).map(identityKey))
const totals = {
  gradedRequests: 0,
  sourceRequests: 0,
  sourceUnavailableRuns: 0,
  sourcePendingAttempts: 0,
  abortedFromPending: 0,
  gradedPendingAttempts: 0,
  unknownAttemptCosts: 0,
  unknownCostRuns: 0,
}

for (const outcome of outcomes) {
  const key = identityKey(outcome)
  if (records.has(key)) issue(`Duplicate outcome identity ${key}`)
  if (planned.size && !planned.has(key)) issue(`Outcome is not in frozen plan: ${key}`)
  const archive = resolve(outcome.archive)
  if (!archive.startsWith(`${raw}/`)) {
    issue(`Outcome archive escapes this raw directory: ${outcome.archive}`)
    continue
  }
  const name = basename(archive)
  const expectedName = `${outcome.taskId}-${outcome.arm}-r${outcome.replicate}`
  if (name !== expectedName) issue(`Archive identity ${name} does not match ${expectedName}`)

  const gradedPath = resolve(archive, 'graded-ledger.json')
  const sourcePath = resolve(archive, 'agent-ledger.json')
  const collectionPath = resolve(archive, 'collection.json')
  const trialPath = resolve(archive, 'trial.json')
  const executionPath = resolve(archive, 'agent-execution.json')
  if (!existsSync(gradedPath)) {
    unknown.push(`${name}: graded ledger not yet archived`)
    continue
  }
  const graded = readJson(gradedPath)
  const label = `${name}`
  totals.gradedRequests += graded.attempts.length
  totals.gradedPendingAttempts += graded.attempts.filter((attempt) => attempt.status === 'pending').length
  totals.unknownAttemptCosts += graded.attempts.filter((attempt) => attempt.cost === null).length
  if (graded.totalCost === null) totals.unknownCostRuns++
  if (graded.attempts.some((attempt) => attempt.status === 'pending'))
    issue(`${label}: graded ledger still has pending attempts`)
  records.set(key, { outcome, graded, archive })
  for (const record of [outcome, graded]) {
    if (
      record.taskId !== outcome.taskId ||
      record.arm !== outcome.arm ||
      record.replicate !== outcome.replicate
    )
      issue(`${label}: task/arm/replicate identity differs across outcome and ledger`)
  }
  if (!existsSync(sourcePath)) {
    totals.sourceUnavailableRuns++
    unknown.push(`${name}: original agent ledger unavailable for direct reconciliation`)
  } else {
    const source = readJson(sourcePath)
    totals.sourceRequests += source.attempts.length
    if (source.runId !== graded.runId)
      issue(`${label}: source and graded runId differ`)
    for (const field of ['taskId', 'arm', 'replicate', 'model', 'provider']) {
      if (source[field] !== graded[field])
        issue(`${label}: source and graded ${field} differ`)
      if (
        ['taskId', 'arm', 'replicate'].includes(field) &&
        (source[field] !== outcome[field] || graded[field] !== outcome[field])
      )
        issue(`${label}: source/graded ${field} does not match outcome`)
    }
    const preservation = checkAttemptPreservation(source, graded, label)
    if (preservation) {
      totals.sourcePendingAttempts += preservation.sourceCounts.pending
      totals.abortedFromPending += preservation.gradedCounts.abortedFromPending
    }
    checkLedgerCost(source, `${label} source`)
  }

  const costs = checkLedgerCost(graded, `${label} graded`)
  compareNumber(outcome.knownCostUSD, graded.knownCost, `${label} outcome known cost`)
  compareNumber(outcome.totalCostUSD, graded.totalCost, `${label} outcome total cost`)
  if (outcome.requests !== graded.attempts.length)
    issue(`${label}: outcome request count differs from graded attempt count`)
  if (!isDeepStrictEqual(outcome.usageTotals, graded.usageTotals))
    issue(`${label}: outcome usage totals differ from graded ledger`)
  if (existsSync(executionPath)) {
    const execution = readJson(executionPath)
    const requestCount = execution.execution?.requestCount
    if (Number.isInteger(requestCount) && requestCount !== graded.attempts.length)
      issue(`${label}: execution requestCount ${requestCount} differs from ${graded.attempts.length} ledger attempts`)
  }

  let exceptionInfo = null
  if (existsSync(trialPath)) {
    // Read only verification and exception metadata; never print or use task/agent text.
    const trial = readJson(trialPath)
    exceptionInfo = trial.exception_info ?? null
    const reward = trial.verifier_result?.rewards?.reward ?? null
    if (reward !== outcome.reward) issue(`${label}: archived verifier reward differs from outcome`)
  }
  let diagnostics = []
  if (existsSync(collectionPath)) diagnostics = readJson(collectionPath).diagnostics ?? []
  const hasException =
    Boolean(exceptionInfo) ||
    diagnostics.length > 0 ||
    outcome.exit !== 0 ||
    outcome.timedOut === true
  const expectedSuccess =
    outcome.reward === 1 &&
    !hasException &&
    outcome.executionStatus === 'completed' &&
    graded.attempts.length > 0
  if (graded.success !== expectedSuccess || outcome.success !== expectedSuccess)
    issue(`${label}: success does not match independent verifier/exception check`)
  if ((graded.success || outcome.success) && (outcome.reward !== 1 || hasException))
    issue(`${label}: success granted without reward=1 and no exception`)

  checked.push({
    name,
    attempts: graded.attempts.length,
    completedAttempts: graded.attempts.filter((attempt) => attempt.status !== 'aborted').length,
    knownCost: graded.knownCost,
    usageComplete: costs.complete,
  })
}

const pairs = new Map()
for (const record of records.values()) {
  const { outcome, graded } = record
  const key = JSON.stringify([outcome.taskId, outcome.replicate])
  if (!pairs.has(key)) pairs.set(key, {})
  const pair = pairs.get(key)
  if (pair[outcome.arm]) issue(`Duplicate ${outcome.arm} run in pair ${key}`)
  pair[outcome.arm] = record
}
let completedPairs = 0
let fullyCostedPairs = 0
let unknownCostPairs = 0
let pairRequestTotal = 0
let pairKnownAttemptCostTotal = 0
let fullyCostedPairTotal = 0
for (const [key, pair] of pairs) {
  if (!pair.baseline || !pair.dcp) continue
  const attempts = [...pair.baseline.graded.attempts, ...pair.dcp.graded.attempts]
  const unknownAttemptCosts = attempts.filter((attempt) => attempt.cost === null).length
  const knownAttemptCost = attempts.reduce(
    (sum, attempt) => sum + (attempt.cost === null ? 0 : attempt.cost),
    0,
  )
  const pairExternalCost =
    pair.baseline.graded.externalCost + pair.dcp.graded.externalCost
  const runKnownCost = pair.baseline.graded.knownCost + pair.dcp.graded.knownCost
  compareNumber(
    runKnownCost,
    knownAttemptCost + pairExternalCost,
    `Completed pair ${key} known-attempt cost`,
  )
  pairKnownAttemptCostTotal += knownAttemptCost
  const fullyCosted =
    unknownAttemptCosts === 0 &&
    pair.baseline.graded.usageComplete &&
    pair.dcp.graded.usageComplete
  if (fullyCosted) {
    fullyCostedPairs++
    const allRequestCost = knownAttemptCost + pairExternalCost
    compareNumber(
      pair.baseline.graded.totalCost + pair.dcp.graded.totalCost,
      allRequestCost,
      `Completed pair ${key} total cost`,
    )
    fullyCostedPairTotal += allRequestCost
  } else unknownCostPairs++
  completedPairs++
  pairRequestTotal += pair.baseline.graded.attempts.length + pair.dcp.graded.attempts.length
}

const summaryPath = resolve(raw, 'summary.json')
if (existsSync(summaryPath)) {
  const summary = readJson(summaryPath)
  if (summary.completedRuns !== outcomes.length)
    issue(`Summary completedRuns ${summary.completedRuns} differs from ${outcomes.length} outcomes`)
  if (summary.plannedRuns !== outcomes.length && summary.fullCohort)
    issue('Summary claims a full cohort but run counts differ')
  if (summary.fullCohort) {
    const outcomeKeys = new Set(outcomes.map(identityKey))
    if (outcomeKeys.size !== planned.size || [...planned].some((key) => !outcomeKeys.has(key)))
      issue('Summary claims a full cohort but outcomes do not cover every frozen plan entry')
  }
  const totals = {
    baseline: { knownCost: 0, complete: true, runCount: 0 },
    dcp: { knownCost: 0, complete: true, runCount: 0 },
  }
  for (const { graded } of records.values()) {
    const arm = totals[graded.arm]
    if (!arm) continue
    arm.knownCost += graded.knownCost
    arm.complete &&= graded.totalCost !== null
    arm.runCount++
  }
  for (const arm of ['baseline', 'dcp']) {
    const expected = totals[arm]
    const summaryArm = arm === 'baseline' ? 'baseline' : 'candidate'
    const observed = summary.observedSubsetComparison[summaryArm]
    compareNumber(observed.knownCost, expected.knownCost, `Summary ${arm} known cost`)
    compareNumber(
      observed.totalCost,
      expected.runCount > 0 && expected.complete ? expected.knownCost : null,
      `Summary ${arm} total cost completeness`,
    )
    if (observed.usageComplete !== (expected.runCount > 0 && expected.complete))
      issue(`Summary ${arm} usageComplete disagrees with per-run ledgers`)
  }
  if (summary.fullCohort && summary.sourceUnchanged) {
    for (const arm of ['baseline', 'dcp']) {
      const summaryArm = arm === 'baseline' ? 'baseline' : 'candidate'
      compareNumber(
        summary.comparison[summaryArm].totalCost,
        totals[arm].runCount > 0 && totals[arm].complete ? totals[arm].knownCost : null,
        `Final comparison ${arm} total cost completeness`,
      )
    }
    if ((!totals.baseline.complete || !totals.dcp.complete) &&
        (summary.comparison.effectiveSavingsRate !== null ||
          summary.comparison.normalizedPeakSavingsRate !== null ||
          summary.comparison.costSavingsInterval !== null ||
          summary.comparison.unavailableReason !== 'unknown_cost'))
      issue('Final comparison made a cost claim despite unknown per-request usage')
  }
}

console.log(`raw=${raw}`)
console.log(`outcomes=${outcomes.length}; planned=${planned.size || 'unknown'}; checked=${checked.length}; completedPairs=${completedPairs}; fullyCostedPairs=${fullyCostedPairs}; unknownCostPairs=${unknownCostPairs}`)
console.log(`completedPairRequests=${pairRequestTotal}; knownAttemptCostUSD=${pairKnownAttemptCostTotal}; fullyCostedPairAllRequestCostUSD=${fullyCostedPairTotal}`)
console.log(`ledgerRequests=${JSON.stringify(totals)}`)
for (const item of checked)
  console.log(`checked ${item.name}: attempts=${item.attempts}, completed=${item.completedAttempts}, knownCostUSD=${item.knownCost}, usageComplete=${item.usageComplete}`)
for (const item of unknown) console.log(`unknown ${item}`)
for (const error of errors) console.error(`FAIL ${error}`)
if (errors.length) process.exitCode = 1
else console.log('PASS: no reconciliation mismatches in currently archived runs')
