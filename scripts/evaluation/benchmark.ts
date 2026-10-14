/** Frozen, local Harbor A/B job runner. Each completed/failed trial remains auditable. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  existsSync,
  cpSync,
} from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { compareArms, finalizeVerification } from './report.js'
import { type RunRecord } from './ledger.js'
import { PRICE_PROVENANCE } from './pricing.js'
import { collectTrial, sessionMetrics, runBounded } from './runner-support.js'
import { resolveConfig } from '../../src/config.js'

const root = process.cwd()
const flags = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!
  const value = process.argv[i + 1]
  if (!key.startsWith('--') || value === undefined)
    throw new Error('Arguments require --key value')
  flags.set(key.slice(2), value)
}
const setup = resolve(flags.get('setup') ?? '.tmp-vitest/evaluation-setup')
const datasetPath = resolve(
  flags.get('dataset') ?? 'docs/evaluation-datasets/terminal-bench-2-2026-10-14.json',
)
const qualificationPath = resolve(
  flags.get('qualification') ?? join(setup, 'qualification-20261014T093314Z.json'),
)
const repetitions = Number(flags.get('repetitions') ?? 2)
const budget = {
  maxRequests: Number(flags.get('max-requests') ?? 80),
  maxSeconds: Number(flags.get('max-seconds') ?? 300),
  maxWallSeconds: Number(flags.get('max-wall-seconds') ?? 480),
  maxRunCostUSD: Number(flags.get('max-run-cost') ?? 1),
  maxTotalCostUSD: Number(flags.get('max-total-cost') ?? 10),
}
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 10)
  throw new Error('repetitions must be from 1 to 10')
for (const value of Object.values(budget))
  if (!Number.isFinite(value) || value <= 0)
    throw new Error('Budgets must be finite and positive')

function sha(bytes: string | Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}
function read<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
function save(path: string, value: unknown, exclusive = false) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: exclusive ? 'wx' : 'w',
  })
}
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)],
  )
}
function runtimeManifest() {
  const paths = [
    ...files(join(root, 'src')).filter((path) => path.endsWith('.ts')),
    ...files(join(root, 'scripts/evaluation')).filter((path) => /\.(ts|py)$/.test(path)),
    join(root, 'tests/e2e-real/opencode-go-adapter.ts'),
    join(root, 'scripts/real-model-config.ts'),
    join(root, 'package.json'),
    join(root, 'pnpm-lock.yaml'),
  ].toSorted()
  return Object.fromEntries(
    paths.map((path) => [relative(root, path), sha(readFileSync(path))]),
  )
}

interface Task {
  taskId: string
  split: string
  status: string
  imageDigest?: string
  imageId?: string
  taskTomlSha256: string
  lockManifestPath: string
  lockManifestSha256: string
}
const dataset = read<{
  datasetCommit: string
  harborCommit: string
  harborVersion: string
  tasks: Array<{ id: string; split: string; inputHashes: Record<string, string> }>
}>(datasetPath)
const qualification = read<{ tasks: Task[] }>(qualificationPath)
const requested = flags.get('tasks')?.split(',')
const selected = dataset.tasks.filter(
  (task) => task.split === 'dev' && (!requested || requested.includes(task.id)),
)
if (
  selected.length === 0 ||
  (requested && requested.some((id) => !selected.some((task) => task.id === id)))
)
  throw new Error('The pilot accepts only tasks frozen in the development split')
const eligible = selected.filter((task) =>
  qualification.tasks.some((item) => item.taskId === task.id && item.status === 'passed'),
)
if (eligible.length === 0)
  throw new Error('No selected tasks passed independent oracle qualification')
function inspectCommand(program: string, args: string[]) {
  return execFileSync(program, args, { encoding: 'utf8' }).trim()
}
if (
  inspectCommand('git', ['-C', join(setup, 'terminal-bench-2'), 'rev-parse', 'HEAD']) !==
    dataset.datasetCommit ||
  inspectCommand('git', ['-C', join(setup, 'harbor-source'), 'rev-parse', 'HEAD']) !==
    dataset.harborCommit ||
  inspectCommand(join(setup, '.venv/bin/python'), [
    '-c',
    'from importlib.metadata import version; print(version("harbor"))',
  ]) !== dataset.harborVersion
)
  throw new Error('Frozen dataset/Harbor version mismatch')
for (const task of selected) {
  for (const [name, hash] of Object.entries(task.inputHashes)) {
    if (sha(readFileSync(join(setup, 'terminal-bench-2', task.id, name))) !== hash)
      throw new Error(`Frozen task input changed: ${task.id}/${name}`)
  }
}
const id = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const output = resolve(flags.get('output') ?? `docs/evaluation-runs/${id}`)
mkdirSync(join(output, 'raw'), { recursive: true })
const frozenTasks = join(setup, 'frozen-task-inputs', id)
const frozenInputs: Record<string, unknown> = {}
for (const task of eligible) {
  const qualified = qualification.tasks.find((item) => item.taskId === task.id)!
  const original = join(setup, 'terminal-bench-2', task.id)
  if (
    qualified.taskTomlSha256 !== sha(readFileSync(join(original, 'task.toml'))) ||
    sha(readFileSync(qualified.lockManifestPath)) !== qualified.lockManifestSha256 ||
    !qualified.imageDigest?.includes('@sha256:') ||
    inspectCommand('docker', [
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      qualified.imageDigest,
    ]) !== qualified.imageId
  )
    throw new Error(`Qualification identity mismatch: ${task.id}`)
  const frozen = join(frozenTasks, task.id)
  if (existsSync(frozen)) throw new Error(`Frozen task directory already exists: ${task.id}`)
  cpSync(original, frozen, { recursive: true })
  const toml = readFileSync(join(frozen, 'task.toml'), 'utf8')
  const section = /(^\[environment\]\s*\n)([\s\S]*?)(?=^\[|$(?![\s\S]))/m
  let replacements = 0
  const locked = toml.replace(
    section,
    (_, header: string, body: string) =>
      header +
      body.replace(/^docker_image\s*=\s*"[^"\n]+"\s*$/m, () => {
        replacements++
        return `docker_image = "${qualified.imageDigest}"`
      }),
  )
  if (replacements !== 1) throw new Error(`Cannot lock environment image: ${task.id}`)
  writeFileSync(join(frozen, 'task.toml'), locked)
  frozenInputs[task.id] = {
    imageDigest: qualified.imageDigest,
    imageId: qualified.imageId,
    originalTaskTomlSHA: qualified.taskTomlSha256,
    lockedTaskTomlSHA: sha(locked),
    files: Object.fromEntries(
      files(frozen)
        .toSorted()
        .map((path) => [relative(frozen, path), sha(readFileSync(path))]),
    ),
  }
}
const source = runtimeManifest()
const sourceHash = sha(JSON.stringify(source))
const orderSeed = 'dsh-dcp-terminal-bench-pilot-2026-10-14'
eligible.sort((a, b) => sha(`${orderSeed}/${a.id}`).localeCompare(sha(`${orderSeed}/${b.id}`)))
const plan = eligible
  .flatMap((task, index) =>
    Array.from({ length: repetitions }, (_, repeat) => {
      const arms = (index + repeat) % 2 === 0 ? ['baseline', 'dcp'] : ['dcp', 'baseline']
      return arms.map((arm) => ({ taskId: task.id, arm, replicate: repeat + 1 }))
    }),
  )
  .flat()
save(
  join(output, 'raw/protocol.json'),
  {
    version: 1,
    experiment:
      'development pilot; standard original tasks; production dsh minimal terminal preset',
    createdAt: new Date().toISOString(),
    datasetSHA: sha(readFileSync(datasetPath)),
    qualificationSHA: sha(readFileSync(qualificationPath)),
    sourceHash,
    selectionMethod:
      'Frozen metadata-stratified convenience subset; oracle-qualified before each task inference',
    selected,
    qualificationExcluded: selected.filter(
      (task) => !eligible.some((item) => item.id === task.id),
    ),
    plan,
    repetitions,
    orderSeed,
    armOrder: 'contiguous pairs; reversed on alternate repetitions',
    budget,
    frozenInputs,
    model: {
      provider: 'deepseek',
      model: 'deepseek-flash',
      thinking: 'disabled',
      baseURL: 'https://api.deepseek.com/v1',
      contextWindow: 1_000_000,
      outputLimit: 4096,
    },
    compaction: { auto: true, maxTokens: 4096, otherFields: 'host defaults, identical arms' },
    dcpConfigurations: {
      baseline: resolveConfig({ enabled: false }),
      dcp: resolveConfig({ enabled: true }),
    },
    compressionOpportunity:
      'One original user turn per task; default retainRecentTurns=2 may make all turn ranges ineligible. No forced trigger or protection override.',
    taskTools: ['terminal'],
    paidExternalTools: false,
    price: PRICE_PROVENANCE,
    cache:
      'Natural provider cache; no forced cold claim; sequential arms, repeated tasks may be warm',
    inference:
      'Pilot only; convenience subset; task-cluster CI; insufficient to establish 1pp non-inferiority',
  },
  true,
)
save(join(output, 'raw/runtime-source.json'), source, true)
copyFileSync(datasetPath, join(output, 'raw/dataset.json'))
copyFileSync(qualificationPath, join(output, 'raw/qualification.json'))
const records: RunRecord[] = []
const outcomes: Array<Record<string, unknown>> = []
let reservedSpent = 0
let stopReason: string | null = null

for (let index = 0; index < plan.length; index++) {
  const item = plan[index]!
  if (index % 2 === 0 && reservedSpent + 2 * budget.maxRunCostUSD > budget.maxTotalCostUSD) {
    stopReason = 'batch_cost_reservation'
    break
  }
  if (sha(JSON.stringify(runtimeManifest())) !== sourceHash) {
    stopReason = 'runtime_source_changed'
    break
  }
  const name = `dsh-pilot-${id}-${item.taskId}-${item.arm}-r${item.replicate}`
  const job = join(setup, 'jobs', name)
  if (existsSync(job)) {
    stopReason = 'job_already_exists'
    break
  }
  const frozen = join(frozenTasks, item.taskId)
  const frozenManifest = (frozenInputs[item.taskId] as { files: Record<string, string> }).files
  if (
    JSON.stringify(
      Object.fromEntries(
        files(frozen)
          .toSorted()
          .map((path) => [relative(frozen, path), sha(readFileSync(path))]),
      ),
    ) !== JSON.stringify(frozenManifest)
  ) {
    stopReason = 'frozen_task_changed'
    break
  }
  const archive = join(output, 'raw', `${item.taskId}-${item.arm}-r${item.replicate}`)
  mkdirSync(archive, { recursive: true })
  const startedAt = Date.now()
  console.log(JSON.stringify({ kind: 'start', index: index + 1, total: plan.length, ...item }))
  // Sequential pairs intentionally control order and enforce the shared budget.
  // eslint-disable-next-line no-await-in-loop
  const processResult = await runBounded(
    join(setup, '.venv/bin/harbor'),
    [
      'run',
      '--path',
      frozen,
      '--agent',
      'scripts.evaluation.harbor_agent:DSHAgent',
      '--model',
      'deepseek/deepseek-flash',
      '--ak',
      `arm=${item.arm}`,
      '--ak',
      `task_id=${item.taskId}`,
      '--ak',
      `replicate=${item.replicate}`,
      '--ak',
      `max_requests=${budget.maxRequests}`,
      '--ak',
      `max_seconds=${budget.maxSeconds}`,
      '--ak',
      `max_cost_usd=${budget.maxRunCostUSD}`,
      '--env',
      'docker',
      '--n-concurrent',
      '1',
      '--n-attempts',
      '1',
      '--jobs-dir',
      join(setup, 'jobs'),
      '--job-name',
      name,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PYTHONPATH: root,
        HARBOR_TELEMETRY: '0',
        TMPDIR: join(setup, 'tmp'),
      },
      logPath: join(archive, 'harbor.txt'),
      maxWallMs: budget.maxWallSeconds * 1000,
      graceMs: 15_000,
    },
  )
  const collected = collectTrial(
    job,
    item.taskId,
    {
      runId: name,
      ...item,
      model: 'deepseek-flash',
      provider: 'deepseek',
      startedAt,
    },
    Date.now(),
  )
  const { trialDir: trial, reward, ledger: record, executionStatus } = collected
  const verified = finalizeVerification(record, {
    reward,
    exception: processResult.exit !== 0 || processResult.timedOut || collected.exception,
    executionStatus,
  })
  save(join(archive, 'collection.json'), {
    ...processResult,
    diagnostics: collected.diagnostics,
  })
  records.push(verified)
  reservedSpent += verified.totalCost ?? Math.max(verified.knownCost, budget.maxRunCostUSD)
  save(join(archive, 'graded-ledger.json'), verified)
  if (trial) {
    if (existsSync(join(trial, 'result.json')))
      copyFileSync(join(trial, 'result.json'), join(archive, 'trial.json'))
    for (const path of [
      'agent/ledger.json',
      'agent/execution.json',
      'verifier/reward.txt',
      'verifier/test-stdout.txt',
    ]) {
      if (existsSync(join(trial, path)))
        copyFileSync(join(trial, path), join(archive, path.replaceAll('/', '-')))
    }
  }
  const sessionPath = trial ? join(trial, 'agent/session.jsonl') : ''
  const bytes = existsSync(sessionPath) ? readFileSync(sessionPath) : null
  const metrics = bytes
    ? sessionMetrics(bytes)
    : {
        compressionCalls: 0,
        totalSummaries: 0,
        dcpSummaries: 0,
        complete: false,
      }
  if (bytes) writeFileSync(join(archive, 'session.jsonl.gz'), gzipSync(bytes), { mode: 0o600 })
  const { compressionCalls, totalSummaries, dcpSummaries } = metrics
  const outcome = {
    ...item,
    ...processResult,
    reward,
    success: verified.success,
    knownCostUSD: verified.knownCost,
    totalCostUSD: verified.totalCost,
    requests: verified.attempts.length,
    usageTotals: verified.usageTotals,
    cacheHitRate:
      verified.usageComplete &&
      verified.usageTotals.uncachedInputTokens + verified.usageTotals.cacheReadTokens > 0
        ? verified.usageTotals.cacheReadTokens /
          (verified.usageTotals.uncachedInputTokens + verified.usageTotals.cacheReadTokens)
        : null,
    priceWindows: [...new Set(verified.attempts.map((attempt) => attempt.prices.window))],
    compressionCalls,
    nativeSummaryAttempts: verified.attempts.filter(
      (attempt) => attempt.metadata.purpose === 'compaction',
    ).length,
    nativeSummaries: Math.max(0, totalSummaries - dcpSummaries),
    dcpSummaries,
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    executionStatus,
    sessionMetricsComplete: metrics.complete,
    diagnostics: collected.diagnostics,
    archive: relative(root, archive),
  }
  outcomes.push(outcome)
  save(join(output, 'raw/outcomes.json'), outcomes)
  console.log(
    JSON.stringify({ kind: 'finished', index: index + 1, total: plan.length, ...outcome }),
  )
}
const sourceUnchanged = sha(JSON.stringify(runtimeManifest())) === sourceHash
const observedSubsetComparison = compareArms(records)
const fullCohort = records.length === plan.length
const summary = {
  comparison:
    fullCohort && sourceUnchanged
      ? observedSubsetComparison
      : {
          ...observedSubsetComparison,
          effectiveSavingsRate: null,
          normalizedPeakSavingsRate: null,
          costSavingsInterval: null,
          qualityLowerBound: null,
          unavailableReason: sourceUnchanged ? 'incomplete_cohort' : 'runtime_source_changed',
        },
  observedSubsetComparison,
  outcomes,
  stopReason,
  sourceUnchanged,
  plannedRuns: plan.length,
  completedRuns: records.length,
  fullCohort,
  budget,
  reservedSpentUSD: reservedSpent,
  verdict: 'development pilot; no quality non-inferiority claim',
}
save(join(output, 'raw/summary.json'), summary)
const percent = (value: number | null) =>
  value === null ? '不可用' : `${(value * 100).toFixed(2)}%`
const usd = (value: number | null) => (value === null ? 'unknown' : `$${value.toFixed(6)}`)
const { baseline, candidate } = summary.comparison
const text = [
  '# Terminal-Bench dsh A/B 开发 pilot',
  '',
  `运行 ID：${id}。官方 DeepSeek / deepseek-flash / thinking disabled，真实 dsh 0.2.0-rc.2 核心与容器 terminal preset。`,
  '',
  `计划 ${plan.length} 次任务运行，完成 ${records.length}；源文件一致：${sourceUnchanged}；停止原因：${stopReason ?? '正常完成'}。`,
  '',
  '| 方案 | 运行/成功 | Q | 总费用 USD | 每成功任务 K |',
  '| --- | --- | --- | --- | --- |',
  `| baseline | ${baseline.runCount}/${baseline.successCount} | ${percent(baseline.quality)} | ${usd(baseline.totalCost)} | ${usd(baseline.costPerSuccess)} |`,
  `| dcp | ${candidate.runCount}/${candidate.successCount} | ${percent(candidate.quality)} | ${usd(candidate.totalCost)} | ${usd(candidate.costPerSuccess)} |`,
  '',
  `实测价窗有效节省率：${percent(summary.comparison.effectiveSavingsRate)}；统一峰值费率节省率：${percent(summary.comparison.normalizedPeakSavingsRate)}。`,
  '',
  '此为非随机开发便利子集上的 pilot；样本量与保守质量下界不能证明 1pp 非劣。费用按官方当日价表和完整 usage 计量，未查账户扣款账单；unknown 不按零处理。',
  '',
  '原始任务、资格失败与未运行候选均保留在冻结数据集/资格快照。此轮不使用 holdout 调参，不宣称完整 benchmark 或榜单结果。',
  '',
  '每任务按原始指令运行一个用户 turn；DCP 默认保护最近两个 turn，可能没有合法压缩范围。未触发压缩时，此轮只能评估当前配置的整体开销与行为，不能证明阶段压缩的收益或损害。',
  '',
  '[完整配置与计划](raw/protocol.json) · [统计与逐运行结果](raw/summary.json) · [运行输入源码指纹](raw/runtime-source.json)',
  '',
  '| 任务 | 方案 | 重复 | 验收 | 请求 | 费用 USD | compress 调用 | 耗时 s |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...outcomes.map(
    (row) =>
      `| ${row.taskId} | ${row.arm} | ${row.replicate} | ${row.success ? '通过' : '失败'} | ${row.requests} | ${usd(row.totalCostUSD as number | null)} | ${row.compressionCalls} | ${Number(row.elapsedSeconds).toFixed(1)} |`,
  ),
  '',
].join('\n')
writeFileSync(join(output, 'report.md'), text)
console.log(
  JSON.stringify({
    kind: 'complete',
    report: relative(root, join(output, 'report.md')),
    completedRuns: records.length,
    stopReason,
  }),
)
