/** Local-only, whole-inventory usage audit. No model calls or private payload exports. */
import { createHash } from 'node:crypto'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  discoverTraces,
  getDiscoveryStats,
  readTrace,
  type TraceDescriptor,
} from './audit-history-traces.js'
import { extractPromptSamples, summarizePromptTokens } from './history-context-metrics.js'

const root = process.cwd()
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const output = join(root, 'docs/history-trace-audit', `${timestamp}-context`)
const homes = new Set([join(homedir(), '.dsh')])
if (process.env.DSH_HOME?.trim())
  homes.add(resolve(process.env.DSH_HOME.replace(/^~(?=\/|$)/, homedir()).trim()))
const roots = new Set<string>()
async function directory(path: string) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
for (const home of homes) {
  for (const suffix of ['sessions', 'data/sessions']) {
    const candidate = join(home, suffix)
    if (await directory(candidate)) roots.add(candidate)
  }
  const profiles = join(home, 'profiles')
  if (!(await directory(profiles))) continue
  for (const entry of await readdir(profiles, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const suffix of ['sessions', 'data/sessions']) {
      const candidate = join(profiles, entry.name, suffix)
      if (await directory(candidate)) roots.add(candidate)
    }
  }
}
const inventory: TraceDescriptor[] = []
const rootDiagnostics = []
for (const path of roots) {
  const traces = await discoverTraces(path)
  inventory.push(...traces)
  rootDiagnostics.push({
    rootHash: createHash('sha256').update(path).digest('hex').slice(0, 20),
    count: traces.length,
    discovery: getDiscoveryStats(traces),
  })
}
// A migration/fork copy must not duplicate the same logical session's old format.
const selected = new Map<string, TraceDescriptor>()
for (const descriptor of inventory) {
  const previous = selected.get(descriptor.sessionHash)
  if (
    !previous ||
    descriptor.headerVersion > previous.headerVersion ||
    (descriptor.headerVersion === previous.headerVersion &&
      descriptor.modifiedAt > previous.modifiedAt)
  )
    selected.set(descriptor.sessionHash, descriptor)
}

type Series = {
  recorded: number[]
  exact: number[]
  lower: number[]
  peaks: number[]
  means: number[]
  tail: number[]
  sessions: number
  sessionsWithUsage: number
}
const series = new Map<string, Series>()
const records: Array<Record<string, unknown>> = []
const failures: Array<{ sessionHash: string; version: number; reason: string }> = []
const add = (
  key: string,
  values: { recorded: number[]; exact: number[]; lower: number[]; tail: number[] },
) => {
  let group = series.get(key)
  if (!group) {
    group = {
      recorded: [],
      exact: [],
      lower: [],
      peaks: [],
      means: [],
      tail: [],
      sessions: 0,
      sessionsWithUsage: 0,
    }
    series.set(key, group)
  }
  group.sessions++
  group.recorded.push(...values.recorded)
  group.exact.push(...values.exact)
  group.lower.push(...values.lower)
  group.tail.push(...values.tail)
  if (values.lower.length) {
    group.sessionsWithUsage++
    group.peaks.push(Math.max(...values.lower))
  }
  if (values.recorded.length)
    group.means.push(
      values.recorded.reduce((sum, value) => sum + value, 0) / values.recorded.length,
    )
}
let index = 0
let firstObservationAt: number | null = null
let lastObservationAt: number | null = null
let unknownObservationTimes = 0
const calendarDays: Record<string, number> = {}
for (const descriptor of selected.values()) {
  try {
    const trace = await readTrace(descriptor)
    const { samples, diagnostics } = extractPromptSamples(
      trace.events,
      trace.header.seedLength ?? 0,
    )
    const sampleSeqs = new Set(samples.map((sample) => sample.seq))
    const times = new Map<number, number>()
    for (const event of trace.events) {
      if (
        sampleSeqs.has(event.seq) &&
        Number.isFinite(event.time) &&
        event.time >= Date.parse('2000-01-01T00:00:00Z') &&
        event.time < Date.parse('2100-01-01T00:00:00Z')
      )
        times.set(event.seq, event.time)
    }
    for (const sample of samples) {
      const time = times.get(sample.seq)
      if (time === undefined) {
        unknownObservationTimes++
        continue
      }
      firstObservationAt = Math.min(firstObservationAt ?? time, time)
      lastObservationAt = Math.max(lastObservationAt ?? time, time)
      const day = new Date(time).toISOString().slice(0, 10)
      calendarDays[day] = (calendarDays[day] ?? 0) + 1
    }
    const recorded = samples.flatMap((sample) =>
      sample.promptTokens === null ? [] : [sample.promptTokens],
    )
    const exact = samples.flatMap((sample) =>
      sample.method === 'exact_total' && sample.promptTokens !== null
        ? [sample.promptTokens]
        : [],
    )
    const lower = samples.flatMap((sample) =>
      sample.lowerBoundTokens === null ? [] : [sample.lowerBoundTokens],
    )
    const lastThird = samples
      .slice(Math.floor((samples.length * 2) / 3))
      .flatMap((sample) => (sample.promptTokens === null ? [] : [sample.promptTokens]))
    const kind =
      trace.header.parentSessionHash || trace.header.delegationDepth > 0 ? 'child' : 'root'
    const values = { recorded, exact, lower, tail: lastThird }
    for (const key of [
      'all',
      kind,
      `v${trace.header.version}`,
      `v${trace.header.version}:${kind}`,
    ])
      add(key, values)
    records.push({
      sessionHash: trace.sessionHash,
      version: trace.header.version,
      kind,
      createdAt: new Date(trace.header.createdAt).toISOString(),
      seedLength: trace.header.seedLength ?? 0,
      complete: trace.source.complete,
      sequenceContinuous: trace.source.sequenceContinuous,
      observations: samples.length,
      methodCounts: samples.reduce<Record<string, number>>((counts, sample) => {
        counts[sample.method] = (counts[sample.method] ?? 0) + 1
        return counts
      }, {}),
      reasonCounts: samples.reduce<Record<string, number>>((counts, sample) => {
        if (sample.reason) counts[sample.reason] = (counts[sample.reason] ?? 0) + 1
        return counts
      }, {}),
      context: summarizePromptTokens(recorded),
      exactContext: summarizePromptTokens(exact),
      knownLowerBoundContext: summarizePromptTokens(lower),
      lastThirdContext: summarizePromptTokens(lastThird),
      diagnostics,
    })
  } catch {
    // Reader errors can contain private filenames. Export only an opaque failure category.
    failures.push({
      sessionHash: descriptor.sessionHash,
      version: descriptor.headerVersion,
      reason: 'unreadable_or_excluded_or_changed',
    })
  }
  index++
  if (index % 100 === 0)
    process.stdout.write(
      `${JSON.stringify({ kind: 'progress', processed: index, total: selected.size })}\n`,
    )
}
const groups = Object.fromEntries(
  [...series].map(([key, group]) => [
    key,
    {
      sessions: group.sessions,
      sessionsWithUsage: group.sessionsWithUsage,
      requestWeightedContext: summarizePromptTokens(group.recorded),
      exactTotalContext: summarizePromptTokens(group.exact),
      knownLowerBoundContext: summarizePromptTokens(group.lower),
      sessionPeakKnownLowerBound: summarizePromptTokens(group.peaks),
      sessionWeightedMean: group.means.length
        ? group.means.reduce((a, b) => a + b, 0) / group.means.length
        : null,
      lastThirdRequestContext: summarizePromptTokens(group.tail),
    },
  ]),
)
const report = {
  generatedAt: new Date().toISOString(),
  design:
    'Whole available inventory; newest format/copy per logical session; owned events only; no external calls',
  privacy: { rawPersisted: false, modelCalls: 0, privatePathsExported: false },
  rootDiagnostics,
  physicalFiles: inventory.length,
  logicalSessions: selected.size,
  decodedSessions: records.length,
  failures,
  observationTimeRange: {
    first: firstObservationAt === null ? null : new Date(firstObservationAt).toISOString(),
    last: lastObservationAt === null ? null : new Date(lastObservationAt).toISOString(),
    unknownObservationTimes,
    calendarDays,
  },
  methodology: {
    unit: 'tokens; input includes cached read/write plus uncached input; never cumulative session tokens',
    exact: 'totalTokens - outputTokens; never add cache again',
    recordedBuckets:
      'Validated historical disjoint fields; absent cache fields are unobserved, sum is known lower bound, not invented API exact usage',
    dedup:
      'stream before settlement; append originals; exclude inherited seed; retry headers separate',
    percentiles: 'nearest rank',
    tail: 'last third of recorded attempts in each session; conditional late-stage diagnostic',
  },
  groups,
  records,
}
await mkdir(output, { recursive: true })
await writeFile(
  join(output, 'context-distribution.json'),
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx', mode: 0o600 },
)
process.stdout.write(
  `${JSON.stringify({ kind: 'complete', report: join('docs/history-trace-audit', `${timestamp}-context/context-distribution.json`), physicalFiles: inventory.length, logicalSessions: selected.size, decodedSessions: records.length, failed: failures.length, groups })}\n`,
)
