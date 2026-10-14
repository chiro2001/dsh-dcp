import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  buildScenarioPrefix,
  createScenarioFiles,
  buildScenarioVerifier,
  buildScenarioQualification,
  SCENARIO_REFERENCE_IMPLEMENTATION,
} from '../../scripts/evaluation/single-scenario.js'

const FIXTURE_KEYS = ['events.jsonl', 'ledger.py', 'smoke_test.py', 'spec.md']
const EVENT_FIELDS = [
  'event_id',
  'account_id',
  'kind',
  'currency',
  'amount',
  'reverses',
  'occurred_at',
  'delivery_seq',
  'trace_id',
]

let tempRoot: string

beforeEach(async () => {
  const parent = join(process.cwd(), '.tmp-vitest')
  await mkdir(parent, { recursive: true })
  tempRoot = await mkdtemp(join(parent, 'single-scenario-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function jsonlRows(source: string): Array<Record<string, unknown>> {
  return source
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

async function writeFixture(directory: string, files: Record<string, string>): Promise<void> {
  await mkdir(directory, { recursive: true })
  await Promise.all(
    Object.entries(files).map(([name, contents]) =>
      writeFile(join(directory, name), contents, 'utf8'),
    ),
  )
}

function runSmokeTest(directory: string) {
  const result = spawnSync('python3', ['-I', 'smoke_test.py'], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (result.error) throw result.error
  return result
}

function runVerifier(directory: string, verifier: string) {
  const result = spawnSync('python3', ['-I', '-c', verifier], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (result.error) throw result.error
  return result
}

function verifierSummary(stdout: string): {
  passed: boolean
  total: number
  checks: Array<{ name: string; passed: boolean }>
} {
  const line = stdout.trim().split(/\r?\n/).at(-1)
  if (line === undefined) throw new Error('verifier did not print a final JSON line')
  return JSON.parse(line) as {
    passed: boolean
    total: number
    checks: Array<{ name: string; passed: boolean }>
  }
}

function textBlocks(message: Record<string, unknown> | undefined): string[] {
  if (!message || !Array.isArray(message.content)) return []
  return message.content.flatMap((block) => {
    if (!block || typeof block !== 'object') return []
    const value = block as Record<string, unknown>
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  })
}

describe('single complex historical-context scenario fixture', () => {
  it('generates byte-identical default files and independent returned objects', () => {
    const first = createScenarioFiles()
    const second = createScenarioFiles()

    expect(Object.keys(first).toSorted()).toEqual(FIXTURE_KEYS)
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
    first['spec.md'] = 'mutated test clone'
    expect(second['spec.md']).not.toBe('mutated test clone')
    expect(jsonlRows(second['events.jsonl']!)).toHaveLength(4096)
  })

  it('writes the requested count of shaped, deterministic JSONL events', () => {
    const files = createScenarioFiles({ eventCount: 40 })
    const rows = jsonlRows(files['events.jsonl']!)

    expect(rows).toHaveLength(40)
    for (const row of rows) {
      expect(Object.keys(row).toSorted()).toEqual(EVENT_FIELDS.toSorted())
      expect(['post', 'reverse']).toContain(row.kind)
    }
    expect(files['spec.md']).toContain('Synthetic benchmark replay')
    expect(files['spec.md']).not.toContain(SCENARIO_REFERENCE_IMPLEMENTATION)
    expect(files['ledger.py']).not.toBe(SCENARIO_REFERENCE_IMPLEMENTATION)
  })

  it('contains the advertised duplicate, invalid-amount, cross-currency, and unknown-reversal cases', () => {
    const rows = jsonlRows(createScenarioFiles({ eventCount: 40 })['events.jsonl']!).slice(
      0,
      16,
    )
    const posts = rows.filter((row) => row.kind === 'post')
    const postsById = new Map(posts.map((row) => [row.event_id, row]))
    const reversals = rows.filter((row) => row.kind === 'reverse')
    const amountIsInvalid = (value: unknown) => {
      if (typeof value === 'number')
        return !Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(value * 100)
      if (typeof value !== 'string') return true
      return !/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0
    }
    const ids = rows.map((row) => row.event_id)
    const hasDuplicateId = new Set(ids).size < ids.length
    const hasInvalidAmount = rows.some((row) => amountIsInvalid(row.amount))
    const hasCrossCurrencyReversal = reversals.some((row) => {
      const target = postsById.get(row.reverses)
      return target !== undefined && target.currency !== row.currency
    })
    const hasUnknownReversal = reversals.some((row) => !postsById.has(row.reverses))

    expect({
      hasDuplicateId,
      hasInvalidAmount,
      hasCrossCurrencyReversal,
      hasUnknownReversal,
    }).toEqual({
      hasDuplicateId: true,
      hasInvalidAmount: true,
      hasCrossCurrencyReversal: true,
      hasUnknownReversal: true,
    })
  })

  it('fails the buggy local ledger smoke test while the independent reference passes it', async () => {
    const files = createScenarioFiles({ eventCount: 16 })
    const buggyDir = join(tempRoot, 'buggy')
    await writeFixture(buggyDir, files)
    const buggy = runSmokeTest(buggyDir)
    expect(buggy.status).not.toBe(0)

    const referenceDir = join(tempRoot, 'reference')
    await writeFixture(referenceDir, {
      ...files,
      'ledger.py': SCENARIO_REFERENCE_IMPLEMENTATION,
    })
    const reference = runSmokeTest(referenceDir)
    expect(reference.status).toBe(0)
  })

  it('runs a host-only full-input verifier and rejects stale or smoke-hardcoded results', async () => {
    const files = createScenarioFiles({ eventCount: 48 })
    const verifier = buildScenarioVerifier(files)
    const contents = Object.values(files).join('\n')
    const prefix = JSON.stringify(buildScenarioPrefix(files))
    expect(contents).not.toContain(SCENARIO_REFERENCE_IMPLEMENTATION)
    expect(contents).not.toContain(verifier)
    expect(prefix).not.toContain(SCENARIO_REFERENCE_IMPLEMENTATION)
    expect(prefix).not.toContain(verifier)

    const acceptedDir = join(tempRoot, 'accepted')
    await writeFixture(acceptedDir, {
      ...files,
      'ledger.py': SCENARIO_REFERENCE_IMPLEMENTATION,
    })
    const generated = spawnSync(
      'python3',
      ['-I', 'ledger.py', 'events.jsonl', 'balances.json'],
      {
        cwd: acceptedDir,
        encoding: 'utf8',
        timeout: 10_000,
      },
    )
    if (generated.error) throw generated.error
    expect(generated.status).toBe(0)
    await writeFile(join(acceptedDir, 'repair.md'), 'Implemented exact-cent ledger replay.\n')
    expect((await stat(join(acceptedDir, 'repair.md'))).size).toBeGreaterThan(0)

    const accepted = runVerifier(acceptedDir, verifier)
    expect(accepted.status).toBe(0)
    const summary = verifierSummary(accepted.stdout)
    expect(summary.passed).toBe(true)
    expect(summary.total).toBeGreaterThanOrEqual(6)
    expect(summary.checks.length).toBe(summary.total)
    expect(summary.checks.every((check) => check.passed && check.name.length > 0)).toBe(true)

    const staleDir = join(tempRoot, 'stale-events')
    await writeFixture(staleDir, {
      ...files,
      'ledger.py': SCENARIO_REFERENCE_IMPLEMENTATION,
    })
    await writeFile(
      join(staleDir, 'balances.json'),
      await readFile(join(acceptedDir, 'balances.json')),
    )
    await writeFile(join(staleDir, 'repair.md'), 'Implemented exact-cent ledger replay.\n')
    const rows = jsonlRows(files['events.jsonl']!)
    const added = {
      ...rows[16],
      event_id: 'verifier-tamper-extra-post',
      kind: 'post',
      amount: '123.45',
      reverses: '',
    }
    await writeFile(
      join(staleDir, 'events.jsonl'),
      `${files['events.jsonl']}${JSON.stringify(added)}\n`,
    )
    const stale = runVerifier(staleDir, verifier)
    const staleSummary = stale.stdout.trim() ? verifierSummary(stale.stdout) : undefined
    expect(stale.status !== 0 || staleSummary?.passed === false).toBe(true)

    const hardcodedDir = join(tempRoot, 'smoke-hardcoded')
    const smokeOnlyLedger = `import json, sys\nwith open(sys.argv[2], 'w') as output:\n    json.dump({'balances': {'smoke': {'USD': 10, 'EUR': 100}}, 'accepted': 4, 'rejected': 3, 'duplicates': 1}, output, sort_keys=True)\n`
    await writeFixture(hardcodedDir, { ...files, 'ledger.py': smokeOnlyLedger })
    const smoke = runSmokeTest(hardcodedDir)
    expect(smoke.status).toBe(0)
    const hardcodedOutput = spawnSync(
      'python3',
      ['-I', 'ledger.py', 'events.jsonl', 'balances.json'],
      { cwd: hardcodedDir, encoding: 'utf8', timeout: 10_000 },
    )
    if (hardcodedOutput.error) throw hardcodedOutput.error
    expect(hardcodedOutput.status).toBe(0)
    await writeFile(join(hardcodedDir, 'repair.md'), 'Implemented exact-cent ledger replay.\n')
    const hardcoded = runVerifier(hardcodedDir, verifier)
    const hardcodedSummary = hardcoded.stdout.trim()
      ? verifierSummary(hardcoded.stdout)
      : undefined
    expect(hardcoded.status !== 0 || hardcodedSummary?.passed === false).toBe(true)
  })

  it('isolates verifier, candidate, and smoke processes from hostile modules in the work directory', async () => {
    const files = createScenarioFiles({ eventCount: 16 })
    const verifier = buildScenarioVerifier(files)
    const hostileModules = {
      'json.py': "raise RuntimeError('workdir json.py must not be imported')\n",
      'subprocess.py': "raise RuntimeError('workdir subprocess.py must not be imported')\n",
      'sitecustomize.py': "raise RuntimeError('workdir sitecustomize.py must not run')\n",
    }

    const referenceDir = join(tempRoot, 'isolated-reference')
    await writeFixture(referenceDir, {
      ...files,
      'ledger.py': SCENARIO_REFERENCE_IMPLEMENTATION,
      ...hostileModules,
    })
    const referenceRun = spawnSync(
      'python3',
      ['-I', 'ledger.py', 'events.jsonl', 'balances.json'],
      { cwd: referenceDir, encoding: 'utf8', timeout: 10_000 },
    )
    if (referenceRun.error) throw referenceRun.error
    expect(referenceRun.status).toBe(0)
    await writeFile(join(referenceDir, 'repair.md'), 'Implemented exact-cent ledger replay.\n')

    const smoke = runSmokeTest(referenceDir)
    expect(smoke.status).toBe(0)
    const accepted = runVerifier(referenceDir, verifier)
    expect(accepted.status).toBe(0)
    expect(verifierSummary(accepted.stdout).passed).toBe(true)

    const badDir = join(tempRoot, 'isolated-bad-ledger')
    await writeFixture(badDir, { ...files, ...hostileModules })
    const badRun = spawnSync('python3', ['-I', 'ledger.py', 'events.jsonl', 'balances.json'], {
      cwd: badDir,
      encoding: 'utf8',
      timeout: 10_000,
    })
    if (badRun.error) throw badRun.error
    expect(badRun.status).toBe(0)
    await writeFile(join(badDir, 'repair.md'), 'Implemented exact-cent ledger replay.\n')
    const rejected = runVerifier(badDir, verifier)
    const rejectedSummary = rejected.stdout.trim()
      ? verifierSummary(rejected.stdout)
      : undefined
    expect(rejected.status !== 0 || rejectedSummary?.passed === false).toBe(true)
  })

  it('qualifies the default full fixture through stdin without altering its original files', async () => {
    const files = createScenarioFiles()
    const qualification = buildScenarioQualification(files)
    expect(Buffer.byteLength(qualification)).toBeGreaterThan(128 * 1024)

    const directory = join(tempRoot, 'qualification')
    await writeFixture(directory, files)
    const before = Object.fromEntries(
      await Promise.all(
        Object.keys(files).map(async (name) => [name, await readFile(join(directory, name))]),
      ),
    )
    const result = spawnSync('python3', ['-I', '-'], {
      cwd: directory,
      encoding: 'utf8',
      input: qualification,
      timeout: 30_000,
    })
    if (result.error) throw result.error
    expect(result.status).toBe(0)
    for (const name of Object.keys(files)) {
      expect(await readFile(join(directory, name))).toEqual(before[name])
    }
  })

  it('builds an isolated replay prefix with three closed turns and complete tool pairs', () => {
    const files = createScenarioFiles()
    const firstPrefix = buildScenarioPrefix(files)
    const secondPrefix = buildScenarioPrefix(files)
    expect(firstPrefix).toEqual(secondPrefix)
    expect(firstPrefix).not.toBe(secondPrefix)
    expect(firstPrefix[0]).not.toBe(secondPrefix[0])
    expect(firstPrefix[0]?.data).not.toBe(secondPrefix[0]?.data)

    const session = Session.create(SessionId('single-scenario-prefix'), firstPrefix)
    const events = [...session.snapshotEvents()]
    const turnEnds = events.filter((event) => event.type === 'turn/end')
    expect(turnEnds).toHaveLength(3)
    expect(
      turnEnds.every(
        (event) => event.type === 'turn/end' && event.data.reason.kind === 'completed',
      ),
    ).toBe(true)

    const assistantCalls = events.flatMap((event) => {
      if (event.type !== 'assistant/message') return []
      return event.data.message.content.flatMap((block) =>
        block.type === 'tool-call' ? [String(block.id)] : [],
      )
    })
    const durableCalls = events
      .filter((event) => event.type === 'tool/call')
      .map((event) => (event.type === 'tool/call' ? String(event.data.callId) : ''))
    const results = events
      .filter((event) => event.type === 'tool/result')
      .map((event) =>
        event.type === 'tool/result' ? String(event.data.message.source.callId) : '',
      )
    expect(assistantCalls.toSorted()).toEqual(durableCalls.toSorted())
    expect(results.toSorted()).toEqual(durableCalls.toSorted())

    const assistantMessages = events.filter((event) => event.type === 'assistant/message')
    expect(
      assistantMessages.every(
        (event) => event.type === 'assistant/message' && !event.data.usage,
      ),
    ).toBe(true)
    for (const event of assistantMessages) {
      if (event.type !== 'assistant/message') continue
      expect(event.data.message.source).toMatchObject({
        provider: 'synthetic-benchmark',
        model: 'deterministic-fixture',
      })
    }

    const derived = session.deriveMessages()
    expect(
      derived.some((message) =>
        message.content.some(
          (block) => block.type === 'text' && block.text.includes('Synthetic benchmark replay'),
        ),
      ),
    ).toBe(true)
    expect(derived.every((message) => !('usage' in message))).toBe(true)
  })

  it('returns the requested event page as tool output without padding records', () => {
    const files = createScenarioFiles()
    const rows = files['events.jsonl']!.trimEnd().split(/\r?\n/)
    const session = Session.create(
      SessionId('single-scenario-page'),
      buildScenarioPrefix(files),
    )
    const events = [...session.snapshotEvents()]
    const calls = events.flatMap((event) => {
      if (event.type !== 'assistant/message') return []
      return event.data.message.content.flatMap((block) => {
        if (block.type !== 'tool-call' || block.name !== 'terminal') return []
        const args = JSON.parse(block.arguments) as { command?: unknown }
        return typeof args.command === 'string' && args.command.includes('events.jsonl')
          ? [{ id: String(block.id), command: args.command }]
          : []
      })
    })
    const results = events.flatMap((event) => {
      if (event.type !== 'tool/result') return []
      return textBlocks(event.data.message as unknown as Record<string, unknown>).map(
        (text) => ({
          callId: String(event.data.message.source.callId),
          text,
        }),
      )
    })

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      const match = call.command.match(/sed\s+-n\s+(\d+),(\d+)p\s+events\.jsonl/)
      expect(match).not.toBeNull()
      const start = Number(match?.[1])
      const end = Number(match?.[2])
      expect(end - start + 1).toBe(64)
      const expectedPage = rows.slice(start - 1, end).join('\n')
      const result = results.find((candidate) => candidate.callId === call.id)
      expect(result).toBeDefined()
      const wrapper = JSON.parse(result!.text) as { stdout: string; returnCode: number }
      expect(wrapper.returnCode).toBe(0)
      expect(wrapper.stdout).toBe(expectedPage)
    }
  })
})
