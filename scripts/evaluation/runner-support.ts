import { existsSync, readFileSync, readdirSync, openSync, closeSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { recoverRun } from './recover.js'
import type { RunDescriptor, RunRecord } from './ledger.js'
import { decodeDcpMeta } from '../../src/protocol/metadata.js'

interface TrialResult {
  task_name?: string
  verifier_result?: { rewards?: { reward?: number } }
  exception_info?: unknown
}

/** Bound setup, inference and verification together; allow Harbor to clean up first. */
export async function runBounded(
  program: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    logPath: string
    maxWallMs: number
    graceMs: number
  },
) {
  if (
    !Number.isFinite(options.maxWallMs) ||
    options.maxWallMs <= 0 ||
    !Number.isFinite(options.graceMs) ||
    options.graceMs <= 0
  )
    throw new Error('Invalid wall timeout')
  const fd = openSync(options.logPath, 'wx', 0o600)
  try {
    return await new Promise<{ exit: number; timedOut: boolean; spawnError?: string }>(
      (fulfill) => {
        let timedOut = false
        let killTimer: ReturnType<typeof setTimeout> | undefined
        const child = spawn(program, args, {
          cwd: options.cwd,
          env: options.env,
          stdio: ['ignore', fd, fd],
          detached: true,
        })
        const signal = (value: NodeJS.Signals) => {
          if (!child.pid) return
          try {
            process.kill(-child.pid, value)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
          }
        }
        const timer = setTimeout(() => {
          timedOut = true
          signal('SIGINT')
          killTimer = setTimeout(() => signal('SIGKILL'), options.graceMs)
        }, options.maxWallMs)
        const clear = () => {
          clearTimeout(timer)
          if (killTimer) clearTimeout(killTimer)
        }
        child.once('error', (error) => {
          clear()
          fulfill({ exit: -1, timedOut, spawnError: error.message })
        })
        child.once('close', (code) => {
          clear()
          fulfill({ exit: code ?? -1, timedOut })
        })
      },
    )
  } finally {
    closeSync(fd)
  }
}

/** An incomplete trial still owns its already incurred requests and fees. */
export function collectTrial(
  job: string,
  taskId: string,
  descriptor: RunDescriptor,
  finishedAt: number,
) {
  const diagnostics: string[] = []
  const candidates = existsSync(job)
    ? readdirSync(job, { withFileTypes: true }).filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name.startsWith(`${taskId}__`) ||
            existsSync(join(job, entry.name, 'agent')) ||
            existsSync(join(job, entry.name, 'result.json'))),
      )
    : []
  const trialDir = candidates.length === 1 ? join(job, candidates[0]!.name) : null
  if (candidates.length !== 1)
    diagnostics.push(`Expected one owned trial; found ${candidates.length}`)
  function read<T>(name: string): T | null {
    if (!trialDir) return null
    try {
      return JSON.parse(readFileSync(join(trialDir, name), 'utf8')) as T
    } catch {
      diagnostics.push(`Missing or malformed ${name}`)
      return null
    }
  }
  const result = read<TrialResult>('result.json')
  const partial = read<RunRecord>('agent/ledger.json')
  let ledger: RunRecord
  try {
    ledger = recoverRun(partial, descriptor, finishedAt)
  } catch {
    diagnostics.push('Invalid ledger identity or accounting')
    ledger = recoverRun(null, descriptor, finishedAt)
  }
  const execution = read<{ execution?: { status?: string } }>('agent/execution.json')
  const status = execution?.execution?.status
  const executionStatus: 'completed' | 'budget_exceeded' | 'error' =
    status === 'completed' || status === 'budget_exceeded' ? status : 'error'
  const rawReward = result?.verifier_result?.rewards?.reward
  const reward =
    typeof rawReward === 'number' &&
    Number.isFinite(rawReward) &&
    rawReward >= 0 &&
    rawReward <= 1
      ? rawReward
      : null
  if (result?.task_name && result.task_name !== `terminal-bench/${taskId}`)
    diagnostics.push('Verifier task identity mismatch')
  return {
    trialDir,
    result,
    ledger,
    executionStatus,
    reward,
    exception: diagnostics.length > 0 || Boolean(result?.exception_info),
    diagnostics,
  }
}

/** Counters from valid events are retained; damaged logs are never complete. */
export function sessionMetrics(bytes: Buffer | string) {
  let compressionCalls = 0
  let totalSummaries = 0
  let dcpSummaries = 0
  let complete = true
  for (const line of bytes.toString().split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line) as {
        type: string
        data: { name?: string; message?: { source?: unknown } }
      }
      if (typeof event.type !== 'string' || !event.data) throw new Error('Invalid event')
      if (event.type === 'tool/call' && event.data.name === 'compress') compressionCalls++
      if (event.type === 'compaction/summary') totalSummaries++
      if (event.type === 'user/message') {
        const metadata = decodeDcpMeta(event.data.message?.source)
        if (metadata.ok && metadata.meta.kind === 'summary') dcpSummaries++
      }
    } catch {
      complete = false
    }
  }
  return { compressionCalls, totalSummaries, dcpSummaries, complete }
}
