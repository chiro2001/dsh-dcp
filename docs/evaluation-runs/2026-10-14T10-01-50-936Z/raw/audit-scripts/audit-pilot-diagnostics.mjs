import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, relative, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const raw = resolve(
  process.argv[2] ?? 'docs/evaluation-runs/2026-10-14T10-01-50-936Z/raw',
)
const repo = process.cwd()
const runId = basename(resolve(raw, '..'))
const setup = resolve(repo, '.tmp-vitest/evaluation-setup')
const protocol = JSON.parse(readFileSync(join(raw, 'protocol.json'), 'utf8'))
const outcomes = JSON.parse(readFileSync(join(raw, 'outcomes.json'), 'utf8'))

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount
}

function safeEnum(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
    ? value
    : 'other'
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(path) : [path]
  })
}

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function runtimeSourceManifest() {
  const paths = [
    ...collectFiles(join(repo, 'src')).filter((path) => path.endsWith('.ts')),
    ...collectFiles(join(repo, 'scripts/evaluation')).filter((path) => /\.(ts|py)$/.test(path)),
    join(repo, 'tests/e2e-real/opencode-go-adapter.ts'),
    join(repo, 'scripts/real-model-config.ts'),
    join(repo, 'package.json'),
    join(repo, 'pnpm-lock.yaml'),
  ].toSorted()
  const manifest = Object.fromEntries(
    paths.map((path) => [relative(repo, path), sha(readFileSync(path))]),
  )
  return manifest
}

function verifyFrozenInputs() {
  const base = join(setup, 'frozen-task-inputs', runId)
  const results = {}
  for (const [taskId, frozen] of Object.entries(protocol.frozenInputs ?? {})) {
    const taskDirectory = join(base, taskId)
    if (!existsSync(taskDirectory)) {
      results[taskId] = false
      continue
    }
    const currentFiles = Object.fromEntries(
      collectFiles(taskDirectory)
        .toSorted()
        .map((path) => [relative(taskDirectory, path), sha(readFileSync(path))]),
    )
    results[taskId] = JSON.stringify(currentFiles) === JSON.stringify(frozen.files)
  }
  return results
}

function newArmSummary() {
  return {
    runCount: 0,
    requests: 0,
    officialRewardOne: 0,
    officialRewardUnknown: 0,
    strictSuccess: 0,
    usageCompleteRuns: 0,
    knownUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    elapsedSeconds: [],
    budgetFailureReasons: {},
    maxTokensErrors: 0,
    executionErrorsByReason: {},
    verifierExceptionTypes: {},
    verifierExceptions: 0,
    exceptionMetadataUnavailable: 0,
    officialRewardOutcomeMismatches: 0,
    successInvariantViolations: 0,
    sessionsChecked: 0,
    sessionsMissing: 0,
    malformedSessionLines: 0,
    eventTypes: {},
    sourceKinds: {},
    dcpCheckpointKinds: {},
    dcpCheckpointModes: {},
    surfaceOps: {},
    dcpUserMessageSourceAppends: 0,
    compactionPruneEvents: 0,
    compactionSummaryEvents: 0,
    otherCompactionEvents: {},
    compressToolCalls: 0,
  }
}

function exceptionType(info) {
  if (info === null || info === undefined) return null
  if (typeof info !== 'object' || Array.isArray(info)) return '<unclassified>'
  return safeEnum(info.type ?? info.exception_type ?? info.name)
}

function addSessionMetadata(arm, sessionPath) {
  if (!existsSync(sessionPath)) {
    arm.sessionsMissing++
    return
  }
  arm.sessionsChecked++
  const content = gunzipSync(readFileSync(sessionPath)).toString('utf8')
  for (const line of content.split('\n').filter(Boolean)) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      arm.malformedSessionLines++
      continue
    }
    const type = typeof event.type === 'string' ? event.type : '<missing-type>'
    increment(arm.eventTypes, type)
    if (type === 'compaction/prune') arm.compactionPruneEvents++
    else if (type === 'compaction/summary') arm.compactionSummaryEvents++
    else if (type.startsWith('compaction/')) increment(arm.otherCompactionEvents, type)

    const data = event.data && typeof event.data === 'object' ? event.data : {}
    if (type === 'tool/call' && data.name === 'compress') arm.compressToolCalls++
    if (type === 'user/message') {
      const op = data.surfaceOp?.op ?? (typeof data.surfaceOp === 'string' ? data.surfaceOp : 'append')
      increment(arm.surfaceOps, safeEnum(op))
    }
    const message = data.message && typeof data.message === 'object' ? data.message : null
    const source = message?.source ?? data.source
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue
    if (typeof source.kind === 'string') {
      increment(arm.sourceKinds, safeEnum(source.kind))
      if (type === 'user/message' && source.kind === 'dsh-dcp' && data.surfaceOp === undefined)
        arm.dcpUserMessageSourceAppends++
    }
    const dcp = source.dcp
    if (dcp && typeof dcp === 'object' && !Array.isArray(dcp)) {
      if (typeof dcp.kind === 'string') increment(arm.dcpCheckpointKinds, safeEnum(dcp.kind))
      if (typeof dcp.mode === 'string') increment(arm.dcpCheckpointModes, safeEnum(dcp.mode))
    }
  }
}

const arms = { baseline: newArmSummary(), dcp: newArmSummary() }
const outcomeKeys = new Set()
for (const outcome of outcomes) {
  const arm = arms[outcome.arm]
  if (!arm) continue
  const key = JSON.stringify([outcome.taskId, outcome.arm, outcome.replicate])
  outcomeKeys.add(key)
  arm.runCount++
  arm.requests += Number.isFinite(outcome.requests) ? outcome.requests : 0
  arm.strictSuccess += Number(outcome.success === true)
  if (Number.isFinite(outcome.elapsedSeconds)) arm.elapsedSeconds.push(outcome.elapsedSeconds)
  if (outcome.totalCostUSD !== null) arm.usageCompleteRuns++
  for (const field of Object.keys(arm.knownUsage))
    arm.knownUsage[field] += outcome.usageTotals?.[field] ?? 0

  const archive = resolve(repo, outcome.archive)
  const trialPath = join(archive, 'trial.json')
  const executionPath = join(archive, 'agent-execution.json')
  const collectionPath = join(archive, 'collection.json')
  const sessionPath = join(archive, 'session.jsonl.gz')
  let officialReward = null
  let exceptionInfo = null
  if (existsSync(trialPath)) {
    const trial = readJson(trialPath)
    officialReward = trial.verifier_result?.rewards?.reward ?? null
    exceptionInfo = trial.exception_info ?? null
    if (exceptionInfo) {
      arm.verifierExceptions++
      increment(arm.verifierExceptionTypes, exceptionType(exceptionInfo))
    }
  } else arm.exceptionMetadataUnavailable++
  if (officialReward === 1) arm.officialRewardOne++
  if (officialReward === null) arm.officialRewardUnknown++
  if (officialReward !== (outcome.reward ?? null)) arm.officialRewardOutcomeMismatches++

  let execution = null
  if (existsSync(executionPath)) execution = readJson(executionPath).execution ?? null
  const executionReason = safeEnum(execution?.reason)
  if (execution?.status === 'budget_exceeded') increment(arm.budgetFailureReasons, executionReason)
  if (executionReason === 'max-tokens') arm.maxTokensErrors++
  if (execution?.status === 'error') increment(arm.executionErrorsByReason, executionReason)

  let processException = false
  let diagnostics = []
  if (existsSync(collectionPath)) {
    const collection = readJson(collectionPath)
    processException = collection.exit !== 0 || collection.timedOut === true
    diagnostics = collection.diagnostics ?? []
  }
  const hasException = Boolean(exceptionInfo) || processException || diagnostics.length > 0
  const grade = existsSync(join(archive, 'graded-ledger.json'))
    ? readJson(join(archive, 'graded-ledger.json'))
    : null
  const attemptCount = grade?.attempts?.length ?? outcome.requests ?? 0
  const expectedSuccess =
    officialReward === 1 &&
    !hasException &&
    execution?.status === 'completed' &&
    attemptCount > 0
  if (outcome.success !== expectedSuccess) arm.successInvariantViolations++

  addSessionMetadata(arm, sessionPath)
}

for (const arm of Object.values(arms)) {
  arm.knownOnlyWeightedCacheHitRate =
    arm.knownUsage.uncachedInputTokens + arm.knownUsage.cacheReadTokens > 0
      ? arm.knownUsage.cacheReadTokens /
        (arm.knownUsage.uncachedInputTokens + arm.knownUsage.cacheReadTokens)
      : null
  arm.elapsedSecondsP95NearestRank = arm.elapsedSeconds.length
    ? arm.elapsedSeconds.toSorted((a, b) => a - b)[Math.ceil(0.95 * arm.elapsedSeconds.length) - 1]
    : null
  arm.elapsedP95IncludesFailures = true
  delete arm.elapsedSeconds
}

const expectedSourceHash = protocol.sourceHash
const recordedSourceManifest = readJson(join(raw, 'runtime-source.json'))
const currentSourceManifest = runtimeSourceManifest()
const actualSourceHash = sha(JSON.stringify(currentSourceManifest))
const sourcePaths = new Set([
  ...Object.keys(recordedSourceManifest),
  ...Object.keys(currentSourceManifest),
])
const sourceFileMismatches = [...sourcePaths]
  .filter(
    (path) => recordedSourceManifest[path] !== currentSourceManifest[path],
  )
  .toSorted()
const frozenInputResults = verifyFrozenInputs()
const planKeys = new Set((protocol.plan ?? []).map((entry) => JSON.stringify([entry.taskId, entry.arm, entry.replicate])))
const duplicateOutcomeKeys = outcomes.length - outcomeKeys.size
const missingPlanKeys = [...planKeys].filter((key) => !outcomeKeys.has(key)).length
const summary = {
  runId,
  outcomesObserved: outcomes.length,
  plannedRuns: protocol.plan?.length ?? null,
  fullCohort: outcomes.length === (protocol.plan?.length ?? -1),
  identityMismatchCount: [...outcomeKeys].filter((key) => !planKeys.has(key)).length,
  duplicateOutcomeIdentityCount: duplicateOutcomeKeys,
  missingPlanIdentityCount: missingPlanKeys,
  arms,
  sourceHash: {
    matchesProtocol: expectedSourceHash === actualSourceHash,
    expected: expectedSourceHash,
    actual: actualSourceHash,
    recordedManifestMatchesProtocol: sha(JSON.stringify(recordedSourceManifest)) === expectedSourceHash,
    recordedSourceFileCount: Object.keys(recordedSourceManifest).length,
    currentSourceFileCount: Object.keys(currentSourceManifest).length,
    sourceFileHashMismatchCount: sourceFileMismatches.length,
    sourceFileHashMismatches: sourceFileMismatches,
  },
  frozenInputs: {
    expectedTaskCount: Object.keys(protocol.frozenInputs ?? {}).length,
    checkedTaskCount: Object.keys(frozenInputResults).length,
    allMatch: Object.values(frozenInputResults).length > 0 && Object.values(frozenInputResults).every(Boolean),
    taskMatches: frozenInputResults,
  },
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
