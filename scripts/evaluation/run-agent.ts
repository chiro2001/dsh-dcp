/** Harbor's host controller entry. Credentials never enter terminal IPC. */
import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'
import { mkdirSync, writeFileSync, appendFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runTask } from './harness.js'
import { createTerminalBridge } from './bridge.js'
import { readRealModelConfig } from '../real-model-config.js'
import type { RunDescriptor } from './ledger.js'

interface InitFrame {
  kind: 'init'
  descriptor: RunDescriptor
  instruction: string
  cwd: string
  dcpEnabled: boolean
  budget: { maxRequests: number; deadlineMs: number; maxCostUSD: number }
  outputDir: string
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
const responses = new PassThrough()
const bridge = createTerminalBridge(responses, process.stdout)
let initialized = false
const initial = new Promise<InitFrame>((fulfill, reject) => {
  input.on('line', (line) => {
    if (initialized) {
      responses.write(`${line}\n`)
      return
    }
    try {
      const parsed = JSON.parse(line) as InitFrame
      if (parsed.kind !== 'init') throw new Error('First controller frame must be init')
      initialized = true
      fulfill(parsed)
    } catch (error) {
      reject(error)
    }
  })
  input.on('close', () => {
    responses.end()
    if (!initialized) reject(new Error('Controller ended without an init frame'))
  })
})

function save(path: string, value: unknown) {
  const temporary = `${path}.writing`
  // Small synchronous snapshots ensure failure/abort paths cannot discard usage.
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  // Atomic rename, using only the trusted host-controller output directory.
  renameSync(temporary, path)
}

try {
  const init = await initial
  const outputDir = resolve(init.outputDir)
  mkdirSync(outputDir, { recursive: true, mode: 0o700 })
  const config = readRealModelConfig({
    ...process.env,
    DSH_DCP_LLM_API_KEY_ENV: 'DEEPSEEK_API_KEY',
    DSH_DCP_LLM_BASE_URL: 'https://api.deepseek.com/v1',
    DSH_DCP_LLM_MODEL: 'deepseek-flash',
    DSH_DCP_LLM_PROVIDER: 'deepseek',
    DSH_DCP_LLM_THINKING: 'disabled',
  })
  if (!config) throw new Error('Official DeepSeek credential is missing')
  if (init.descriptor.model !== config.model || init.descriptor.provider !== config.provider)
    throw new Error('Task descriptor differs from the frozen official model route')
  const result = await runTask({
    descriptor: init.descriptor,
    instruction: init.instruction,
    cwd: init.cwd,
    dcpEnabled: init.dcpEnabled,
    modelConfig: config,
    maxRequests: init.budget.maxRequests,
    deadlineMs: init.budget.deadlineMs,
    maxCostUSD: init.budget.maxCostUSD,
    terminal: bridge.terminal,
    onSessionEvent(event) {
      appendFileSync(join(outputDir, 'session.jsonl'), `${JSON.stringify(event)}\n`, {
        mode: 0o600,
      })
    },
    onLedger(record) {
      save(join(outputDir, 'ledger.json'), record)
    },
  })
  await save(join(outputDir, 'execution.json'), {
    execution: result.execution,
    verification: result.verification,
    nativeCompaction: result.nativeCompaction,
  })
  process.stdout.write(
    `${JSON.stringify({
      kind: 'done',
      result: {
        ledger: result.ledger,
        execution: result.execution,
        verification: result.verification,
        nativeCompaction: result.nativeCompaction,
      },
    })}\n`,
  )
} catch (error) {
  // Transport details live in the typed ledger; never dump request configs/env.
  const raw = error instanceof Error ? error.message : 'Controller failed'
  const secret = process.env.DEEPSEEK_API_KEY
  const message = (secret ? raw.replaceAll(secret, '<redacted>') : raw)
    .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
    .slice(0, 300)
  process.stdout.write(`${JSON.stringify({ kind: 'controller_error', message })}\n`)
  process.exitCode = 1
} finally {
  bridge.close()
  input.close()
  process.stdin.pause()
}
