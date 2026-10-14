import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  collectTrial,
  runBounded,
  sessionMetrics,
} from '../../scripts/evaluation/runner-support.js'
import { createLedger, type RunDescriptor } from '../../scripts/evaluation/ledger.js'
import { prices } from './helpers.js'

const startedAt = 1_792_000_000_000
let tempRoot: string

function descriptor(overrides: Partial<RunDescriptor> = {}): RunDescriptor {
  return {
    runId: 'collect-run',
    taskId: 'task-1',
    arm: 'baseline',
    replicate: 1,
    model: 'deepseek-flash',
    provider: 'deepseek',
    startedAt,
    ...overrides,
  }
}

function partialLedger(identity = descriptor()) {
  const ledger = createLedger(identity, prices)
  const completed = ledger.startAttempt({
    agentId: 'root-agent',
    sessionId: 'root-session',
    purpose: 'agent-turn',
    startedAt: startedAt + 1_000,
  })
  ledger.finishAttempt(completed, {
    status: 'http_error',
    usage: {
      uncachedInputTokens: 100_000,
      cacheReadTokens: 400_000,
      outputTokens: 20_000,
    },
    finishedAt: startedAt + 2_000,
  })
  ledger.startAttempt({
    agentId: 'child-agent',
    sessionId: 'child-session',
    purpose: 'delegated-analysis',
    startedAt: startedAt + 3_000,
  })
  return ledger.snapshot()
}

async function trialDir(jobDir: string, name: string): Promise<string> {
  const path = join(jobDir, name)
  await mkdir(path, { recursive: true })
  return path
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value)}\n`)
}

beforeEach(async () => {
  const parent = join(process.cwd(), '.tmp-vitest')
  await mkdir(parent, { recursive: true })
  tempRoot = await mkdtemp(join(parent, 'runner-support-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('Harbor runner support', () => {
  it('recovers a ledger when its trial has no result and closes pending usage as unknown', async () => {
    const jobDir = join(tempRoot, 'job-partial')
    const trial = await trialDir(jobDir, 'trial-1')
    const identity = descriptor()
    await writeJson(join(trial, 'agent/ledger.json'), partialLedger(identity))

    const collected = collectTrial(jobDir, 'task-1', identity, startedAt + 10_000)

    expect(collected).toMatchObject({
      trialDir: trial,
      result: null,
      reward: null,
      ledger: {
        outcome: 'infrastructure_error',
        success: false,
        usageComplete: false,
        knownCost: expect.closeTo(0.077, 12),
        totalCost: null,
        attempts: [
          { status: 'http_error', cost: expect.closeTo(0.077, 12) },
          {
            status: 'aborted',
            cost: null,
            usage: null,
            finishedAt: startedAt + 10_000,
            metadata: { agentId: 'child-agent', sessionId: 'child-session' },
          },
        ],
      },
    })
  })

  it('keeps the ledger when result JSON is malformed and never invents a zero-cost success without one', async () => {
    const jobDir = join(tempRoot, 'job-bad-result')
    const trial = await trialDir(jobDir, 'trial-1')
    const identity = descriptor()
    const ledger = createLedger(identity, prices)
    const attempt = ledger.startAttempt({
      agentId: 'root-agent',
      sessionId: 'root-session',
      purpose: 'agent-turn',
      startedAt: startedAt + 1_000,
    })
    ledger.finishAttempt(attempt, {
      status: 'success',
      usage: { uncachedInputTokens: 100_000, cacheReadTokens: 0, outputTokens: 10_000 },
      finishedAt: startedAt + 2_000,
    })
    const billed = ledger.finishRun({ outcome: 'failure', finishedAt: startedAt + 3_000 })
    await writeFile(join(trial, 'result.json'), '{malformed')
    await writeJson(join(trial, 'agent/ledger.json'), billed)
    await writeJson(join(trial, 'agent/execution.json'), {
      execution: { status: 'completed', requestCount: 1 },
    })

    const malformed = collectTrial(jobDir, 'task-1', identity, startedAt + 4_000)

    expect(malformed.reward).toBeNull()
    expect(malformed.ledger).toMatchObject({
      success: false,
      knownCost: expect.closeTo(0.038, 12),
      totalCost: expect.closeTo(0.038, 12),
    })

    const noLedgerJob = join(tempRoot, 'job-no-ledger')
    const noLedgerTrial = await trialDir(noLedgerJob, 'trial-1')
    await writeJson(join(noLedgerTrial, 'result.json'), {
      verifier_result: { rewards: { reward: 1 } },
    })
    await writeJson(join(noLedgerTrial, 'agent/execution.json'), {
      execution: { status: 'completed', requestCount: 1 },
    })

    const noLedger = collectTrial(noLedgerJob, 'task-1', identity, startedAt + 5_000)

    expect(noLedger).toMatchObject({
      reward: 1,
      ledger: {
        outcome: 'infrastructure_error',
        success: false,
        attempts: [],
        knownCost: 0,
        totalCost: null,
        usageComplete: false,
      },
    })
  })

  it('reports multiple Harbor trials without selecting or mixing their ledgers', async () => {
    const jobDir = join(tempRoot, 'job-multiple')
    const identity = descriptor()
    await Promise.all(
      ['trial-1', 'trial-2'].map(async (name) => {
        const trial = await trialDir(jobDir, name)
        await writeJson(join(trial, 'result.json'), {})
        await writeJson(join(trial, 'agent/ledger.json'), partialLedger(identity))
      }),
    )

    const collected = collectTrial(jobDir, 'task-1', identity, startedAt + 10_000)

    expect(collected).toMatchObject({
      trialDir: null,
      result: null,
      reward: null,
      exception: true,
      diagnostics: expect.arrayContaining([expect.any(String)]),
      ledger: {
        outcome: 'infrastructure_error',
        success: false,
        attempts: [],
        knownCost: 0,
        usageComplete: false,
        totalCost: null,
      },
    })
    expect(collected.diagnostics).toContain('Expected one owned trial; found 2')
  })

  it('marks statistics incomplete when a JSONL session ends with a truncated event', () => {
    const completeEvents = [
      { type: 'tool/call', data: { name: 'compress' } },
      { type: 'compaction/summary', data: {} },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n')
    const bytes = Buffer.from(`${completeEvents}\n{"type":"tool/call","data":`, 'utf8')

    expect(sessionMetrics(bytes)).toMatchObject({
      compressionCalls: 1,
      totalSummaries: 1,
      complete: false,
    })
  })

  it('returns ordinary child exits without marking a timeout', async () => {
    const result = await runBounded(process.execPath, ['-e', 'process.exit(0)'], {
      cwd: tempRoot,
      env: process.env,
      logPath: join(tempRoot, 'normal-child.log'),
      maxWallMs: 800,
      graceMs: 150,
    })

    expect(result).toMatchObject({ exit: 0, timedOut: false })
    expect(result.spawnError).toBeUndefined()
  })

  it('sends SIGINT at the wall timeout and records the child handler response', async () => {
    const marker = join(tempRoot, 'sigint.marker')
    const source = [
      `process.on('SIGINT', () => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'seen'); process.exit(0) })`,
      'setInterval(() => {}, 1000)',
    ].join('\n')

    const result = await runBounded(process.execPath, ['-e', source], {
      cwd: tempRoot,
      env: process.env,
      logPath: join(tempRoot, 'sigint-child.log'),
      maxWallMs: 250,
      graceMs: 180,
    })

    expect(result).toMatchObject({ exit: 0, timedOut: true })
    expect(await readFile(marker, 'utf8')).toBe('seen')
  })

  it('returns a spawn error for a missing executable', async () => {
    const result = await runBounded(join(tempRoot, 'missing-executable'), [], {
      cwd: tempRoot,
      env: process.env,
      logPath: join(tempRoot, 'spawn-error.log'),
      maxWallMs: 800,
      graceMs: 150,
    })

    expect(result).toMatchObject({ exit: -1, timedOut: false })
    expect(result.spawnError).toMatch(/ENOENT/)
  })

  it('uses SIGKILL after the grace period when a timed-out child ignores SIGINT', async () => {
    const marker = join(tempRoot, 'ignore-sigint.marker')
    const source = [
      `process.on('SIGINT', () => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'seen'))`,
      'setInterval(() => {}, 1000)',
    ].join('\n')
    const started = Date.now()

    const result = await runBounded(process.execPath, ['-e', source], {
      cwd: tempRoot,
      env: process.env,
      logPath: join(tempRoot, 'sigkill-child.log'),
      maxWallMs: 250,
      graceMs: 180,
    })

    expect(result).toMatchObject({ exit: -1, timedOut: true })
    expect(await readFile(marker, 'utf8')).toBe('seen')
    expect(Date.now() - started).toBeGreaterThanOrEqual(330)
  })
})
