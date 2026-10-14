/* oxlint-disable no-await-in-loop -- Paid trials settle sequentially so a failure stops further calls. */
/** Repeat the invariant-checked real suite; record each run without overwriting evidence. */
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { readRealModelConfig } from './real-model-config.js'

const count = Number(process.env.DSH_DCP_PROBES ?? 3)
if (!Number.isSafeInteger(count) || count < 1 || count > 10) {
  throw new Error('DSH_DCP_PROBES must be an integer from 1 to 10')
}
const scenario = process.env.DSH_DCP_PROBE_SCENARIO ?? 'all'
if (!['all', 'forced', 'correction', 'partial', 'nested', 'small'].includes(scenario)) {
  throw new Error(
    'DSH_DCP_PROBE_SCENARIO must be all, forced, correction, partial, nested, or small',
  )
}
const config = readRealModelConfig()
if (!config) {
  console.log('real-model-probes: no configured credential; skipping')
  process.exit(0)
}
const root = resolve(import.meta.dirname, '..')
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const outputRoot = resolve(root, '.tmp-vitest', `real-model-${stamp}`)
await mkdir(outputRoot, { recursive: true })
const docsRoot = resolve(root, 'docs/real-model-validation')
const evidenceRoot = resolve(docsRoot, stamp)
await mkdir(evidenceRoot, { recursive: true })
const sourceFiles = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vitest.config.ts',
  'cordis.patch.yml',
]
for (const directory of ['src', 'tests', 'scripts']) {
  sourceFiles.push(
    ...(await readdir(resolve(root, directory), { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, resolve(entry.parentPath, entry.name))),
  )
}
const sourceManifest = await Promise.all(
  sourceFiles.toSorted().map(async (path) => ({
    path,
    sha256: createHash('sha256')
      .update(await readFile(resolve(root, path)))
      .digest('hex'),
  })),
)
const manifestText = JSON.stringify(sourceManifest, null, 2) + '\n'
const sourceFingerprint = createHash('sha256').update(manifestText).digest('hex')
await writeFile(resolve(outputRoot, 'source-manifest.json'), manifestText, { flag: 'wx' })
await writeFile(resolve(evidenceRoot, 'source-manifest.json'), manifestText, { flag: 'wx' })
const secrets = Object.entries(process.env)
  .filter(([name, value]) => /(?:key|token|secret)/i.test(name) && value && value.length >= 8)
  .map(([, value]) => value!)
function redact(value: string): string {
  for (const secret of secrets) value = value.replaceAll(secret, '<redacted>')
  return value
}

interface Assertion {
  fullName: string
  status: string
  failureMessages?: string[]
}
interface Report {
  testResults?: Array<{ name: string; assertionResults: Assertion[] }>
}
const runs: Array<{ run: number; exitCode: number; assertions: Assertion[] }> = []
const metrics: string[] = []
for (let index = 0; index < count; index++) {
  const jsonFile = resolve(outputRoot, `run-${index + 1}.json`)
  const args = [
    'node_modules/vitest/vitest.mjs',
    'run',
    ...(scenario === 'forced' ? ['tests/e2e-real/agent.spec.ts'] : ['tests/e2e-real']),
    '--reporter=default',
    '--reporter=json',
  ]
  if (scenario !== 'all' && scenario !== 'forced') {
    args.push('--testNamePattern', scenario === 'correction' ? 'partial' : scenario)
  }
  let output = ''
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, DSH_DCP_REAL_MODEL: '1', TMPDIR: resolve(root, '.tmp-vitest') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolveExit(code ?? 1))
  })
  output = redact(output)
  await writeFile(resolve(outputRoot, `run-${index + 1}.log`), output, { flag: 'wx' })
  await writeFile(resolve(evidenceRoot, `run-${index + 1}.txt`), output, { flag: 'wx' })
  const jsonLine = output
    .split('\n')
    .find((line) => line.trim().startsWith('{"numTotalTestSuites"'))
  if (jsonLine === undefined)
    throw new Error('Vitest did not produce its structured report; see the redacted run log')
  const report = JSON.parse(jsonLine) as Report
  await writeFile(jsonFile, jsonLine, { flag: 'wx' })
  await writeFile(resolve(evidenceRoot, `run-${index + 1}.json`), jsonLine, { flag: 'wx' })
  const plainOutput = output
    .split('\n')
    .filter((line) => line !== jsonLine)
    .join('\n')
  console.log(plainOutput)
  const assertions = (report.testResults ?? [])
    .filter((file) =>
      ['agent.spec.ts', 'matrix.spec.ts', 'small-range.spec.ts'].includes(basename(file.name)),
    )
    .flatMap((file) => file.assertionResults)
    .filter(
      (test) =>
        test.fullName.startsWith('real agent + configured real model') ||
        test.fullName.startsWith('real provider quality matrix') ||
        test.fullName.startsWith('real provider small-range quality'),
    )
  const selected =
    scenario === 'all'
      ? assertions
      : assertions.filter((test) => test.status !== 'pending' && test.status !== 'skipped')
  const effectiveExit =
    exitCode === 0 && selected.length > 0 && selected.every((test) => test.status === 'passed')
      ? 0
      : 1
  runs.push({ run: index + 1, exitCode: effectiveExit, assertions: selected })
  console.log(
    `Real run ${index + 1}: ${selected.filter((test) => test.status === 'passed').length}/${selected.length} real scenarios passed`,
  )
  metrics.push(...output.split('\n').filter((line) => line.includes('REAL_MODEL_METRICS')))
  if (effectiveExit !== 0) break
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim()
const lines = [
  `# Real-model validation — ${stamp}`,
  '',
  `- Model: ${config.model}; provider: ${config.provider}; gateway: ${new URL(config.baseUrl).host}`,
  `- Thinking: ${config.thinking ?? 'provider default'}; scenario: ${scenario}`,
  `- Source commit: ${commit}; working-tree changes included in this run.`,
  `- Source fingerprint (SHA-256): ${sourceFingerprint}; [file manifest](./${stamp}/source-manifest.json).`,
  `- Requested repeats: ${count}; completed: ${runs.length}. Credentials are never part of the report.`,
  '',
  '| Run | Test | Result |',
  '| --- | --- | --- |',
  ...runs.flatMap((run) =>
    run.assertions.map(
      (test) => `| ${run.run} | ${test.fullName.replaceAll('|', '/')} | ${test.status} |`,
    ),
  ),
  '',
  '## Failures and run logs',
  '',
  ...runs.flatMap((run) => [
    `- Run ${run.run}: [redacted log](./${stamp}/run-${run.run}.txt), [structured results](./${stamp}/run-${run.run}.json).`,
    ...run.assertions
      .filter((test) => test.status !== 'passed')
      .map((test) => {
        const reason = test.failureMessages?.[0]?.split('\n')[0]?.slice(0, 400)
        return `  - ${test.fullName}: ${reason ?? test.status}`
      }),
  ]),
  '',
  '## Measured diagnostics',
  '',
  '```text',
  ...metrics,
  '```',
  '',
  'The partial case uses an explicitly declared transient commit fault with a real model; it is not an observed provider outage.',
  'These results cover this model, gateway and fixture corpus; they do not establish behavior for all models.',
  '',
]
const reportPath = resolve(docsRoot, `${stamp}.md`)
await writeFile(reportPath, redact(lines.join('\n')), { flag: 'wx' })
console.log(`real-model-probes: report ${reportPath}`)
if (runs.some((run) => run.exitCode !== 0)) process.exitCode = 1
