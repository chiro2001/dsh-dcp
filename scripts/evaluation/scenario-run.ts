/** One public long-context checkpoint, two independent real continuations. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../../src/config.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { readRealModelConfig } from '../real-model-config.js'
import { runTask, type TerminalResult } from './harness.js'
import { finalizeVerification } from './report.js'
import { type RunRecord } from './ledger.js'
import {
  createScenarioFiles,
  buildScenarioPrefix,
  buildScenarioVerifier,
  buildScenarioQualification,
} from './single-scenario.js'

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const json = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const config = resolveConfig({
  enabled: true,
  compress: { protectUserMessages: true },
  manualMode: { default: true, automaticStrategies: false },
  nudge: { enabled: false },
})
const specifiedRange = { startRef: 'm0001', endRef: 'm0003' } as const

async function command(
  args: string[],
  options: { input?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<TerminalResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(args[0]!, args.slice(1), {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = [],
      stderr: Buffer[] = []
    let bytes = 0
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes <= 8_000_000) target.push(chunk)
      else child.kill('SIGKILL')
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.on('error', reject)
    const cancel = () => child.kill('SIGKILL')
    const timer = setTimeout(cancel, options.timeoutMs ?? 120_000)
    options.signal?.addEventListener('abort', cancel, { once: true })
    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', cancel)
      resolveResult({
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        returnCode: code ?? 137,
      })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(options.input)
    if (options.signal?.aborted) cancel()
  })
}

async function required(args: string[], input?: string) {
  const result = await command(args, { input })
  if (result.returnCode !== 0)
    throw new Error(
      `Scenario environment command failed: ${args[0]} (exit ${result.returnCode})`,
    )
  return result.stdout.trim()
}

function inventory(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = join(prefix, entry.name)
    if (entry.isDirectory()) return inventory(join(directory, entry.name), relative)
    return entry.isFile() ? [relative] : []
  })
}

type Projection = {
  systemHash: string
  toolsHash: string
  messagesHash: string
  eventCount: number
  inheritedPrefixMatches: boolean
}
type Verified = {
  passed: boolean
  total: number
  checks: Array<{ name: string; passed: boolean }>
}

export async function runSingleScenario(execute = false, eventCount = 4096) {
  const root = process.cwd()
  const id =
    new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-') + '-single-ledger'
  const output = join(root, 'docs/evaluation-runs', id)
  mkdirSync(output)
  const raw = join(output, 'raw'),
    inputs = join(output, 'inputs')
  mkdirSync(raw)
  mkdirSync(inputs)
  const files = createScenarioFiles({ eventCount })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(inputs, name), text)
  const prefix = buildScenarioPrefix(files)
  writeFileSync(join(raw, 'constructed-prefix.json.gz'), gzipSync(JSON.stringify(prefix)))
  const protocol = {
    version: 1,
    taskId: 'single-ledger-repair-v1',
    execute,
    eventCount,
    prefixProvenance:
      'Explicitly synthetic investigation replay; no fabricated usage; public task data only',
    constructedPrefixHash: sha(JSON.stringify(prefix)),
    inputHashes: Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, sha(text)]),
    ),
    model: 'deepseek-flash',
    provider: 'deepseek',
    thinking: 'disabled',
    contextWindow: 1_000_000,
    dcpConfig: config,
    branchOrder: ['inactive', 'active'],
    budgets: {
      prepare: { requests: 3, seconds: 120, costUSD: 0.5 },
      continuation: { requests: 40, seconds: 600, costUSD: 1.0 },
    },
    actualSpendAccounting:
      'common preparation once + both continuations; construction model cost unmeasured, not fabricated',
    inferenceScope:
      'Single specified compression action and real continuation; no population quality/automatic-trigger claim',
    pressureMinimumPromptTokens: 100_000,
    specifiedIntervention: { calls: 1, ranges: 1, ...specifiedRange },
  }
  json(join(raw, 'protocol.json'), protocol)
  if (!execute) {
    json(join(raw, 'preflight.json'), {
      apiCalls: 0,
      prefixBytes: Buffer.byteLength(JSON.stringify(prefix)),
      prefixEvents: prefix.length,
      inputHashes: protocol.inputHashes,
    })
    process.stdout.write(
      JSON.stringify({ kind: 'dry-run', report: output, apiCalls: 0 }) + '\n',
    )
    return output
  }
  const model = readRealModelConfig()
  if (
    !model ||
    new URL(model.baseUrl).origin !== 'https://api.deepseek.com' ||
    model.model !== 'deepseek-flash' ||
    model.provider !== 'deepseek' ||
    model.thinking !== 'disabled'
  )
    throw new Error(
      'This experiment requires official deepseek/deepseek-flash with thinking disabled',
    )
  const sourceFiles = [
    ...inventory(join(root, 'src')).map((p) => join('src', p)),
    ...inventory(join(root, 'scripts/evaluation')).map((p) => join('scripts/evaluation', p)),
    'scripts/real-model-config.ts',
    'tests/e2e-real/opencode-go-adapter.ts',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
  ]
    .filter((p) => /\.(ts|py|json|yaml)$/.test(p))
    .sort()
  json(
    join(raw, 'source-manifest.json'),
    Object.fromEntries(sourceFiles.map((p) => [p, sha(readFileSync(join(root, p)))])),
  )
  await required(['tar', '-czf', join(raw, 'frozen-source.tar.gz'), ...sourceFiles])
  const image = await required([
    'docker',
    'image',
    'inspect',
    'python:3.12-slim',
    '--format',
    '{{.Id}}',
  ])
  json(join(raw, 'environment.json'), {
    image,
    workdir: '/work',
    network: 'none',
    cpus: 1,
    memory: '768m',
    node: process.version,
  })
  const temp = join(root, '.tmp-vitest', id)
  mkdirSync(temp, { recursive: true })
  const containers: string[] = []
  let credentialMatches = 0
  const ledgers: Record<string, RunRecord> = {}
  const projections: Record<string, Projection[]> = {}
  const results: Record<
    string,
    {
      ledger: RunRecord
      verification: Verified
      execution: unknown
      compressionCount: number
      compressionAttemptCount: number
      specifiedCompressionApplied: boolean
    }
  > = {}
  const createEnvironment = async (arm: string) => {
    const directory = join(temp, arm)
    mkdirSync(directory)
    for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text)
    const container = await required([
      'docker',
      'run',
      '-d',
      '--network',
      'none',
      '--cpus',
      '1',
      '--memory',
      '768m',
      '--pids-limit',
      '128',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,size=128m',
      '--mount',
      `type=bind,src=${directory},dst=/work`,
      '-w',
      '/work',
      image,
      'sleep',
      'infinity',
    ])
    containers.push(container)
    return { directory, container }
  }
  const run = async (
    arm: string,
    seed: readonly SessionEvent[],
    instruction: string,
    terminal: (
      cmd: string,
      timeoutSec: number,
      signal?: AbortSignal,
    ) => Promise<TerminalResult>,
    prepare: boolean,
  ) => {
    const runId = `${id}-${arm}`
    projections[arm] = []
    return runTask({
      descriptor: {
        runId,
        taskId: protocol.taskId,
        arm,
        replicate: 1,
        model: model.model,
        provider: model.provider,
        startedAt: Date.now(),
      },
      instruction,
      cwd: '/work',
      seed,
      dcpEnabled: true,
      dcpConfig: config,
      compressionPermission: arm === 'active' ? 'active' : 'inactive',
      maxRequests: prepare ? 3 : 40,
      deadlineMs: prepare ? 120_000 : 600_000,
      maxCostUSD: prepare ? 0.5 : 1.0,
      modelConfig: model,
      terminal,
      onLedger: (record) => {
        ledgers[arm] = record
        json(join(raw, `${arm}-ledger.json`), record)
      },
      onContext: (ctx) => {
        ctx.on('llm/stream', (request, next) => {
          if (request.purpose !== 'compaction') {
            const session = ctx.sessions.get(SessionId(runId))
            if (
              !session ||
              JSON.stringify(request.messages) !== JSON.stringify(session.deriveMessages())
            )
              throw new Error('Scenario request/log invariant failed')
            projections[arm]!.push({
              systemHash: sha(request.system ?? ''),
              toolsHash: sha(JSON.stringify(request.tools ?? [])),
              messagesHash: sha(JSON.stringify(request.messages)),
              eventCount: session.snapshotEvents().length,
              inheritedPrefixMatches:
                JSON.stringify(session.snapshotEvents().slice(0, seed.length)) ===
                JSON.stringify(seed),
            })
          }
          return next()
        })
      },
    })
  }
  try {
    const initial = await createEnvironment('prepare')
    const smoke = await command([
      'docker',
      'exec',
      initial.container,
      'python3',
      '-I',
      'smoke_test.py',
    ])
    const referenceCheck = await command(
      ['docker', 'exec', '-i', initial.container, 'python3', '-I', '-'],
      { input: buildScenarioQualification(files) },
    )
    json(join(raw, 'fixture-qualification.json'), {
      buggySmokeFailed: smoke.returnCode !== 0,
      referencePassed: referenceCheck.returnCode === 0,
    })
    if (smoke.returnCode === 0 || referenceCheck.returnCode !== 0)
      throw new Error('Fixture failed independent qualification')
    const prepared = await run(
      'prepare',
      prefix,
      'Preparation only: consume this explicitly constructed investigation history. Do not call tools, compress, or change files. Reply exactly READY. Code repair remains open for the next turn.',
      async () => ({
        stdout: '',
        stderr: 'Tools are unavailable during common preparation.',
        returnCode: 1,
      }),
      true,
    )
    writeFileSync(
      join(raw, 'prepare-session.json.gz'),
      gzipSync(JSON.stringify(prepared.events)),
    )
    const last = prepared.events.findLast((event) => event.type === 'assistant/message')
    const ready =
      last?.type === 'assistant/message' &&
      last.data.message.content.some(
        (block) => block.type === 'text' && /^READY[.!]?$/i.test(block.text.trim()),
      )
    const prepPrompt = prepared.ledger.attempts[0]?.usage
    const pressure =
      prepPrompt === null || prepPrompt === undefined
        ? null
        : prepPrompt.uncachedInputTokens + prepPrompt.cacheReadTokens
    if (
      prepared.execution.status !== 'completed' ||
      !ready ||
      pressure === null ||
      pressure < 100_000 ||
      prepared.events.some((e) => e.type === 'compaction/summary')
    )
      throw new Error(
        'Common preparation is incomplete, lacks verified pressure, or changed history',
      )
    const checkpoint = prepared.events
    json(join(raw, 'checkpoint.json'), {
      events: checkpoint.length,
      hash: sha(JSON.stringify(checkpoint)),
      promptTokens: pressure,
      commonCostUSD: prepared.ledger.totalCost,
    })
    for (const arm of protocol.branchOrder) {
      const env = await createEnvironment(arm)
      const activation =
        arm === 'active'
          ? `Compression is active. First call compress once for the completed investigation range ${specifiedRange.startRef} (inclusive) to ${specifiedRange.endRef} (exclusive), preserving the task/spec and diagnosis in factual prose. Use native tool_calls. After a committed result, stop compressing and implement the task.`
          : 'Compression is inactive for this continuation. Do not call compress. Continue with the complete investigation history.'
      const task =
        'Repair ledger.py according to the shared spec, run smoke_test.py, produce balances.json from events.jsonl, and write repair.md. Do not modify spec.md, events.jsonl or smoke_test.py. Verify your work with terminal and finish only when the task is complete.'
      process.stdout.write(
        JSON.stringify({ kind: 'branch-start', arm, promptTokens: pressure }) + '\n',
      )
      const completed = await run(
        arm,
        checkpoint,
        `${activation}\n${task}`,
        (cmd, seconds, signal) =>
          command(['docker', 'exec', env.container, 'sh', '-lc', cmd], {
            signal,
            timeoutMs: seconds * 1000,
          }),
        false,
      )
      writeFileSync(
        join(raw, `${arm}-session.json.gz`),
        gzipSync(JSON.stringify(completed.events)),
      )
      const artifacts = join(raw, `${arm}-artifacts`)
      mkdirSync(artifacts)
      for (const name of ['ledger.py', 'balances.json', 'repair.md']) {
        try {
          writeFileSync(join(artifacts, name), readFileSync(join(env.directory, name)))
        } catch {
          /* missing required artifacts are rejected by the independent verifier */
        }
      }
      const verificationResult = await command(
        ['docker', 'exec', '-i', env.container, 'python3', '-I', '-'],
        { input: buildScenarioVerifier(files), timeoutMs: 120_000 },
      )
      let verification: Verified = { passed: false, total: 0, checks: [] }
      try {
        verification = JSON.parse(
          verificationResult.stdout.trim().split('\n').at(-1)!,
        ) as Verified
      } catch {
        /* execution failure remains a failed verifier */
      }
      const ledger = finalizeVerification(completed.ledger, {
        reward: verificationResult.returnCode === 0 && verification.passed ? 1 : 0,
        exception: verification.total === 0,
        executionStatus: completed.execution.status,
      })
      ledgers[arm] = ledger
      json(join(raw, `${arm}-ledger.json`), ledger)
      json(join(raw, `${arm}-verification.json`), verification)
      const blocks = reduceDcpState(completed.events).blocks.filter(
        (block) => block.seq >= checkpoint.length,
      )
      const compressionCount = blocks.length
      const compressionAttempts = completed.events
        .slice(checkpoint.length)
        .filter((event) => event.type === 'tool/call' && event.data.name === 'compress')
      const attempt = compressionAttempts[0]
      let specifiedCompressionApplied = false
      if (
        attempt?.type === 'tool/call' &&
        compressionAttempts.length === 1 &&
        blocks.length === 1
      ) {
        try {
          const args = JSON.parse(attempt.data.arguments) as {
            content?: Array<{ startRef?: string; endRef?: string }>
          }
          specifiedCompressionApplied =
            args.content?.length === 1 &&
            args.content[0]?.startRef === specifiedRange.startRef &&
            args.content[0]?.endRef === specifiedRange.endRef &&
            blocks[0]!.meta.startRef === specifiedRange.startRef &&
            blocks[0]!.meta.endRef === specifiedRange.endRef &&
            blocks[0]!.meta.compressCallId === String(attempt.data.callId)
        } catch {
          /* mismatched calls are not the specified intervention */
        }
      }
      const compressionAttemptCount = compressionAttempts.length
      results[arm] = {
        ledger,
        verification,
        execution: completed.execution,
        compressionCount,
        compressionAttemptCount,
        specifiedCompressionApplied,
      }
      json(join(raw, `${arm}-result.json`), {
        execution: completed.execution,
        compressionCount,
        compressionAttemptCount,
        specifiedCompressionApplied,
        success: ledger.success,
      })
      process.stdout.write(
        JSON.stringify({
          kind: 'branch-complete',
          arm,
          success: ledger.success,
          requests: ledger.attempts.length,
          knownCostUSD: ledger.knownCost,
          totalCostUSD: ledger.totalCost,
          compressionCount,
        }) + '\n',
      )
    }
    const inactive = results.inactive!,
      active = results.active!
    const comparable =
      inactive.ledger.success &&
      active.ledger.success &&
      inactive.ledger.totalCost !== null &&
      active.ledger.totalCost !== null &&
      active.specifiedCompressionApplied &&
      inactive.compressionCount === 0 &&
      inactive.compressionAttemptCount === 0
    const allKnown = Object.values(ledgers).every((record) => record.totalCost !== null)
    const projectionEqual =
      projections.active?.[0]?.systemHash === projections.inactive?.[0]?.systemHash &&
      projections.active?.[0]?.toolsHash === projections.inactive?.[0]?.toolsHash &&
      Object.values(projections)
        .flat()
        .every((p) => p.inheritedPrefixMatches)
    const summary = {
      taskId: protocol.taskId,
      sharedDefinitionAndSeedVerified: projectionEqual,
      comparable,
      continuationSavings:
        comparable && projectionEqual
          ? 1 - active.ledger.totalCost! / inactive.ledger.totalCost!
          : null,
      actualSpendUSD: allKnown
        ? Object.values(ledgers).reduce((n, r) => n + r.totalCost!, 0)
        : null,
      knownSpendUSD: Object.values(ledgers).reduce((n, r) => n + r.knownCost, 0),
      commonCostUSD: ledgers.prepare!.totalCost,
      conditionalTotalCosts: Object.fromEntries(
        ['inactive', 'active'].map((arm) => [
          arm,
          ledgers.prepare!.totalCost === null || ledgers[arm]!.totalCost === null
            ? null
            : ledgers.prepare!.totalCost! + ledgers[arm]!.totalCost!,
        ]),
      ),
      arms: Object.fromEntries(
        ['inactive', 'active'].map((arm) => {
          const r = results[arm]!.ledger
          const prompts = r.attempts
            .flatMap((a) =>
              a.usage ? [a.usage.uncachedInputTokens + a.usage.cacheReadTokens] : [],
            )
            .sort((a, b) => a - b)
          return [
            arm,
            {
              success: r.success,
              requests: r.attempts.length,
              compressionCount: results[arm]!.compressionCount,
              compressionAttemptCount: results[arm]!.compressionAttemptCount,
              specifiedCompressionApplied: results[arm]!.specifiedCompressionApplied,
              totalCostUSD: r.totalCost,
              meanPromptTokens: prompts.length
                ? prompts.reduce((a, b) => a + b, 0) / prompts.length
                : null,
              p95PromptTokens: prompts[Math.ceil(prompts.length * 0.95) - 1] ?? null,
              usageComplete: r.usageComplete,
              usageTotals: r.usageTotals,
            },
          ]
        }),
      ),
    }
    json(join(raw, 'summary.json'), summary)
    const rows = Object.entries(results).flatMap(([arm, r]) => {
      let cumulativeKnownCost = 0
      return r.ledger.attempts.map((a, index) => {
        cumulativeKnownCost += a.cost ?? 0
        return [
          arm,
          index + 1,
          a.metadata.purpose,
          a.status,
          a.usage ? a.usage.uncachedInputTokens + a.usage.cacheReadTokens : '',
          a.usage?.uncachedInputTokens ?? '',
          a.usage?.cacheReadTokens ?? '',
          a.usage?.outputTokens ?? '',
          a.cost ?? '',
          cumulativeKnownCost,
        ].join(',')
      })
    })
    writeFileSync(
      join(output, 'request-costs.csv'),
      'arm,request,purpose,status,prompt_tokens,uncached_input,cache_read,output,cost_usd,cumulative_known_cost_usd\n' +
        rows.join('\n') +
        '\n',
    )
    const cost = (value: number | null) => (value === null ? 'unknown' : '$' + value.toFixed(6))
    const lines = [
      '# 单场景：事件账本修复费用对照',
      '',
      `官方 DeepSeek / deepseek-flash，固定公开 fixture；公共准备输入 ${pressure.toLocaleString('en-US')} tokens。`,
      '',
      '| 分支 | 独立验收 | 请求数 | 平均输入 tokens | 压缩次数 | 续作费用 |',
      '| --- | --- | ---: | ---: | ---: | ---: |',
    ]
    for (const arm of ['inactive', 'active']) {
      const r = summary.arms[arm]!
      lines.push(
        `| ${arm} | ${r.success ? '通过' : '失败'} | ${r.requests} | ${r.meanPromptTokens?.toFixed(0) ?? 'unknown'} | ${r.compressionCount} | ${cost(r.totalCostUSD)} |`,
      )
    }
    lines.push(
      '',
      `续作节省率：${summary.continuationSavings === null ? '不可判定' : (summary.continuationSavings * 100).toFixed(2) + '%'}。共同准备费用 ${cost(summary.commonCostUSD)}，实际实验支出 ${cost(summary.actualSpendUSD)}。`,
      '',
      `同一静态定义与日志 seed 核对：${projectionEqual ? '通过' : '失败'}。`,
      '',
      '历史是明确标注的构造调查回放；公共准备及两条续作使用真实模型。指定一次压缩，保留最近两 turn，不评价自然触发算法或总体非劣。共享前缀以官方 usage 确认缓存；单组顺序固定 inactive→active，缓存状态及模型随机性限制结论范围。',
      '',
      '构造回放之前的自然模型工作费用未测。共同准备仅实际计费一次；完整条件归因成本见 raw/summary.json。失败、缺 usage 和未成功压缩均保留。',
      '',
      '[请求费用表](request-costs.csv) · [完整汇总](raw/summary.json) · [预注册协议](raw/protocol.json) · [冻结源码清单](raw/source-manifest.json)',
    )
    writeFileSync(join(output, 'report.md'), lines.join('\n') + '\n')
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.replaceAll(model.apiKey, '<credential-redacted>')
        : 'unknown execution failure'
    json(join(raw, 'partial.json'), {
      error: message,
      knownSpendUSD: Object.values(ledgers).reduce((n, r) => n + r.knownCost, 0),
      completedArms: Object.keys(results),
    })
    writeFileSync(
      join(output, 'report.md'),
      `# 单场景实验未完成\n\n${message}\n\n保留 partial 用量和所有已发生请求；未补猜费用、未删除失败、未重新运行筛选结果。\n`,
    )
    throw new Error(message, { cause: error })
  } finally {
    json(join(raw, 'request-projections.json'), projections)
    for (const container of containers) await command(['docker', 'rm', '-f', container])
    let scanned = 0,
      matches = 0
    for (const file of inventory(output)) {
      const content = readFileSync(join(output, file))
      const decoded = file.endsWith('.gz') ? gunzipSync(content) : content
      scanned++
      if (decoded.includes(Buffer.from(model.apiKey))) matches++
    }
    credentialMatches = matches
    json(join(raw, 'credential-scan.json'), { scanned, exactLoadedCredentialMatches: matches })
  }
  if (credentialMatches > 0)
    throw new Error('A scenario artifact contains the loaded credential')
  process.stdout.write(JSON.stringify({ kind: 'complete', report: output }) + '\n')
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2)
  const index = flags.indexOf('--event-count')
  runSingleScenario(
    flags.includes('--execute'),
    index < 0 ? 4096 : Number(flags[index + 1]),
  ).catch(() => {
    process.stderr.write(
      'Single-scenario evaluation failed; inspect the preserved local report.\n',
    )
    process.exitCode = 1
  })
}
