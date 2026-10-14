/**
 * Read-only, privacy-preserving audit of persisted DSH history traces.
 *
 * The exported discovery/read helpers are also consumed by the DCP behavior
 * audit. Do not log event objects, headers' cwd, file paths, tool arguments,
 * or message text. CLI output and generated files contain aggregates only.
 * Run with: node --import tsx scripts/audit-history-traces.ts
 */
import { createHash } from 'node:crypto'
import { open, readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

export type TraceEncoding = 'zstd' | 'plain'
export type TraceFileFamily = 'base' | 'v3' | 'other'

export interface TraceDescriptor {
  /** Stable, non-reversible identifier; never the persisted session id. */
  readonly sessionHash: string
  /** Logical format version from the header, not inferred from the filename. */
  readonly headerVersion: number
  readonly createdAt: number
  readonly compressedBytes: number
  readonly modifiedAt: number
  readonly encoding: TraceEncoding
  /** Filename family only; it is not the logical session format version. */
  readonly fileFamily: TraceFileFamily
}

export interface TraceSample {
  readonly trace: TraceDescriptor
  readonly stratum: string
}

export interface TraceHeader {
  readonly version: number
  readonly createdAt: number
  /** Present only in memory; never include it in an audit report. */
  readonly cwd?: string
  readonly parentSessionHash?: string
  readonly seedLength?: number
  readonly origin?: string
  readonly delegationDepth: number
  readonly agentPreset?: string
}

export interface TraceSourceInfo {
  readonly encoding: TraceEncoding
  readonly fileFamily: TraceFileFamily
  readonly compressedBytes: number
  readonly uncompressedBytes: number
  readonly frameCount: number
  readonly storageRows: number
  readonly packedRows: number
  readonly complete: boolean
  readonly tornTail: boolean
  readonly sequenceContinuous: boolean
}

export interface ReadTrace {
  readonly sessionHash: string
  readonly header: TraceHeader
  /** Expanded persisted events. Keep in memory; do not print or serialize. */
  readonly events: readonly TraceEvent[]
  readonly source: TraceSourceInfo
}

export interface TraceEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data?: unknown
  readonly [key: string]: unknown
}

interface HeaderRecord {
  type: 'session'
  version: number
  id: string
  createdAt: number
  cwd?: string
  parentSession?: string
  seedLength?: number
  origin?: string
  delegationDepth?: number
  agentPreset?: string
}

interface FileMeta extends TraceDescriptor {
  readonly mtimeMs: number
}

const sourcePaths = new WeakMap<TraceDescriptor, { path: string; root: string }>()
const cachedHeaders = new WeakMap<TraceDescriptor, HeaderRecord>()
const discoveryStats = new WeakMap<readonly TraceDescriptor[], DiscoveryStats>()
const defaultRoot = join(homedir(), '.dsh', 'sessions')
const MAX_HEADER_PLAINTEXT = 1024 * 1024
const MAX_COMPRESSED_TRACE = 64 * 1024 * 1024
const MAX_UNCOMPRESSED_TRACE = 256 * 1024 * 1024

export interface DiscoveryStats {
  readonly candidateFiles: number
  readonly readableHeaders: number
  readonly excludedProjectDirectories: number
  readonly excludedByHeaderCwd: number
  readonly headerFrameReadFailures: number
  readonly malformedHeaders: number
  readonly metadataStatFailures: number
}

function hashId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 20)
}

function familyOf(file: string): TraceFileFamily {
  const name = basename(file)
  if (name === 'session.jsonl' || name === 'session.jsonl.zstd') return 'base'
  if (name === 'session.v3.jsonl' || name === 'session.v3.jsonl.zstd') return 'v3'
  return 'other'
}

function encodingOf(file: string): TraceEncoding {
  return file.endsWith('.zstd') ? 'zstd' : 'plain'
}

function supportedLogName(name: string): boolean {
  return /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name)
}

/** Return the first complete Zstandard frame's end offset, or undefined at a torn prefix. */
function firstFrameEnd(bytes: Buffer): number | undefined {
  if (bytes.length < 4) return undefined
  if (bytes.readUInt32LE(0) !== 0xfd2fb528) throw new Error('invalid zstd frame')
  let offset = 4
  if (offset === bytes.length) return undefined
  const descriptor = bytes.readUInt8(offset++)
  if ((descriptor & 0x18) !== 0) throw new Error('reserved zstd frame-header bit')
  const sizeFlag = descriptor >>> 6
  const singleSegment = (descriptor & 0x20) !== 0
  const hasChecksum = (descriptor & 0x04) !== 0
  const dictionaryFlag = descriptor & 0x03
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
  const contentSizeBytes = sizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << sizeFlag
  const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
  if (bytes.length - offset < headerBytes) return undefined
  offset += headerBytes
  for (;;) {
    if (bytes.length - offset < 3) return undefined
    const block = bytes.readUIntLE(offset, 3)
    offset += 3
    const last = (block & 1) !== 0
    const blockType = (block >>> 1) & 0x03
    const blockBytes = blockType === 1 ? 1 : block >>> 3
    if (blockType === 3) throw new Error('reserved zstd block type')
    if (bytes.length - offset < blockBytes) return undefined
    offset += blockBytes
    if (last) break
  }
  if (hasChecksum) {
    if (bytes.length - offset < 4) return undefined
    offset += 4
  }
  return offset
}

async function readFirstFrame(file: string, encoding: TraceEncoding): Promise<Buffer> {
  const handle = await open(file, 'r')
  try {
    if (encoding === 'plain') {
      const chunk = Buffer.alloc(64 * 1024)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, 0)
      const data = chunk.subarray(0, bytesRead)
      const newline = data.indexOf(0x0a)
      if (newline < 0) throw new Error('header line exceeds 64 KiB or is incomplete')
      return Buffer.from(data.subarray(0, newline + 1))
    }
    const pieces: Buffer[] = []
    let total = 0
    for (let position = 0; total <= MAX_HEADER_PLAINTEXT; position += 64 * 1024) {
      const chunk = Buffer.alloc(64 * 1024)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (bytesRead === 0) break
      const piece = Buffer.from(chunk.subarray(0, bytesRead))
      pieces.push(piece)
      total += bytesRead
      const prefix = Buffer.concat(pieces, total)
      const end = firstFrameEnd(prefix)
      if (end !== undefined) return prefix.subarray(0, end)
      if (total >= MAX_HEADER_PLAINTEXT) break
    }
    throw new Error('first zstd frame is incomplete or exceeds the header scan limit')
  } finally {
    await handle.close()
  }
}

function parseHeader(plaintext: Buffer): HeaderRecord {
  const newline = plaintext.indexOf(0x0a)
  if (newline < 0) throw new Error('header lacks newline')
  const value: unknown = JSON.parse(plaintext.subarray(0, newline).toString('utf8'))
  if (typeof value !== 'object' || value === null) throw new Error('header is not an object')
  const header = value as Partial<HeaderRecord>
  if (
    header.type !== 'session' ||
    typeof header.version !== 'number' ||
    typeof header.id !== 'string' ||
    typeof header.createdAt !== 'number' ||
    (header.delegationDepth !== undefined && typeof header.delegationDepth !== 'number')
  ) {
    throw new Error('header shape is unsupported')
  }
  return header as HeaderRecord
}

function isExcludedPath(path: string, root: string): boolean {
  const relative = path.slice(root.length).split(/[\\/]+/)
  return relative.some((component) => component.toLowerCase().includes('dsh-oc'))
}

/**
 * Enumerate trace files and read only their first header frame. Any project
 * belonging to the excluded frontend projects is rejected before any file is opened.
 */
export async function discoverTraces(root = defaultRoot): Promise<TraceDescriptor[]> {
  const absoluteRoot = resolve(root)
  const candidates: string[] = []
  let excludedProjectDirectories = 0
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (isExcludedPath(path, absoluteRoot)) {
        if (entry.isDirectory()) excludedProjectDirectories++
        continue
      }
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && supportedLogName(entry.name)) candidates.push(path)
    }
  }
  await walk(absoluteRoot)

  const traces: TraceDescriptor[] = []
  let headerFrameReadFailures = 0
  let malformedHeaders = 0
  let metadataStatFailures = 0
  let excludedByHeaderCwd = 0
  for (const path of candidates) {
    let encoding: TraceEncoding
    let header: HeaderRecord
    try {
      encoding = encodingOf(path)
      const frameOrHeader = await readFirstFrame(path, encoding)
      const plaintext =
        encoding === 'zstd'
          ? zstdDecompressSync(frameOrHeader, { maxOutputLength: MAX_HEADER_PLAINTEXT })
          : frameOrHeader
      try {
        header = parseHeader(plaintext)
      } catch {
        malformedHeaders++
        continue
      }
    } catch {
      headerFrameReadFailures++
      continue
    }
    // A header cwd check protects against a truncated encoded project key. The
    // project directory filter above remains the gate before any file open.
    if ((header.cwd ?? '').toLowerCase().includes('dsh-oc')) {
      excludedByHeaderCwd++
      continue
    }
    let identity
    try {
      identity = await stat(path)
    } catch {
      metadataStatFailures++
      continue
    }
    const descriptor: FileMeta = Object.freeze({
      sessionHash: hashId(header.id),
      headerVersion: header.version,
      createdAt: header.createdAt,
      compressedBytes: identity.size,
      modifiedAt: identity.mtimeMs,
      mtimeMs: identity.mtimeMs,
      encoding,
      fileFamily: familyOf(path),
    })
    sourcePaths.set(descriptor, { path, root: absoluteRoot })
    cachedHeaders.set(descriptor, header)
    traces.push(descriptor)
  }
  const sorted = traces.sort(
    (a, b) =>
      a.headerVersion - b.headerVersion ||
      a.createdAt - b.createdAt ||
      a.sessionHash.localeCompare(b.sessionHash),
  )
  discoveryStats.set(sorted, {
    candidateFiles: candidates.length,
    readableHeaders: sorted.length + excludedByHeaderCwd,
    excludedProjectDirectories,
    excludedByHeaderCwd,
    headerFrameReadFailures,
    malformedHeaders,
    metadataStatFailures,
  })
  return sorted
}

/** Return aggregate scan diagnostics without paths or source text. */
export function getDiscoveryStats(
  traces: readonly TraceDescriptor[],
): DiscoveryStats | undefined {
  return discoveryStats.get(traces)
}

/**
 * Select up to `perVersion` traces per header version, stratifying by compressed
 * size tertile and then creation time. The largest trace of each version is
 * always represented. This makes the sample deterministic and auditable.
 */
export function selectStratifiedSample(
  traces: readonly TraceDescriptor[],
  options: { perVersion?: number } = {},
): TraceSample[] {
  const perVersion = Math.max(1, Math.floor(options.perVersion ?? 30))
  const groups = new Map<number, TraceDescriptor[]>()
  // A migration may leave both filename generations in one session directory.
  // Count/sample at most one physical copy per logical session id + format.
  const deduped = new Map<string, TraceDescriptor>()
  const priority = (trace: TraceDescriptor): number =>
    trace.fileFamily === 'v3' ? 2 : trace.fileFamily === 'base' ? 1 : 0
  for (const trace of traces) {
    const key = `${trace.sessionHash}:${trace.headerVersion}`
    const previous = deduped.get(key)
    if (
      !previous ||
      priority(trace) > priority(previous) ||
      (priority(trace) === priority(previous) && trace.modifiedAt > previous.modifiedAt) ||
      (priority(trace) === priority(previous) &&
        trace.modifiedAt === previous.modifiedAt &&
        trace.compressedBytes > previous.compressedBytes)
    ) {
      deduped.set(key, trace)
    }
  }
  for (const trace of deduped.values()) {
    const group = groups.get(trace.headerVersion) ?? []
    group.push(trace)
    groups.set(trace.headerVersion, group)
  }
  const selected: TraceSample[] = []
  for (const [version, group] of [...groups].sort(([a], [b]) => a - b)) {
    const ordered = [...group].sort(
      (a, b) => a.compressedBytes - b.compressedBytes || a.createdAt - b.createdAt,
    )
    const chosen = new Map<string, string>()
    const n = Math.min(perVersion, ordered.length)
    const binCount = Math.min(3, n)
    for (let bin = 0; bin < binCount; bin++) {
      const from = Math.floor((bin * ordered.length) / binCount)
      const to = Math.floor(((bin + 1) * ordered.length) / binCount)
      const sizeBin = bin === 0 ? 'small' : bin === binCount - 1 ? 'large' : 'medium'
      const ageOrdered = ordered.slice(from, to).sort((a, b) => a.createdAt - b.createdAt)
      const targetCount = Math.max(1, Math.round(n / binCount))
      for (let i = 0; i < targetCount && chosen.size < n; i++) {
        const index = Math.min(
          ageOrdered.length - 1,
          Math.floor(((i + 0.5) * ageOrdered.length) / targetCount),
        )
        const item = ageOrdered[index]
        if (item)
          chosen.set(item.sessionHash, `v${version}:${sizeBin}:age-${i + 1}-of-${targetCount}`)
      }
    }
    const largest = ordered.at(-1)
    if (largest && !chosen.has(largest.sessionHash)) {
      if (chosen.size >= n) chosen.delete(chosen.keys().next().value as string)
      chosen.set(largest.sessionHash, `v${version}:largest`)
    }
    for (const [sessionHash, stratum] of chosen) {
      const trace = group.find((candidate) => candidate.sessionHash === sessionHash)
      if (trace) selected.push({ trace, stratum })
    }
  }
  return selected
}

function decodePackedRow(value: Record<string, unknown>): TraceEvent[] | undefined {
  const tag = value.type
  if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks')
    return undefined
  const data = value.data as Record<string, unknown> | undefined
  if (!data || !Array.isArray(data.dt)) throw new Error('malformed packed chunk row')
  const members = tag === 'tool-call-chunks' ? data.args : data.texts
  if (
    !Array.isArray(members) ||
    members.length === 0 ||
    data.dt.length !== members.length - 1
  ) {
    throw new Error('malformed packed chunk row')
  }
  let time = Number(value.time0)
  const seq0 = Number(value.seq0)
  if (!Number.isSafeInteger(seq0) || !Number.isSafeInteger(time))
    throw new Error('malformed packed chunk row')
  const events: TraceEvent[] = []
  for (let index = 0; index < members.length; index++) {
    if (index > 0) time += Number(data.dt[index - 1])
    const chunk =
      tag === 'text-chunks'
        ? { type: 'text-delta', index: data.index, text: members[index] }
        : tag === 'reasoning-chunks'
          ? { type: 'reasoning-delta', index: data.index, text: members[index] }
          : {
              type: 'tool-call-delta',
              index: data.index,
              id: data.id,
              ...(Object.hasOwn(data, 'name') ? { name: data.name } : {}),
              argumentsDelta: members[index],
            }
    events.push({
      type: 'assistant/chunk',
      seq: seq0 + index,
      time,
      data: { turn: data.turn, step: data.step, chunk },
    })
  }
  return events
}

function headerForRead(header: HeaderRecord): TraceHeader {
  return {
    version: header.version,
    createdAt: header.createdAt,
    ...(header.cwd !== undefined ? { cwd: header.cwd } : {}),
    ...(header.parentSession !== undefined
      ? { parentSessionHash: hashId(header.parentSession) }
      : {}),
    ...(header.seedLength !== undefined ? { seedLength: header.seedLength } : {}),
    ...(header.origin !== undefined ? { origin: header.origin } : {}),
    delegationDepth: header.delegationDepth ?? 0,
    ...(header.agentPreset !== undefined ? { agentPreset: header.agentPreset } : {}),
  }
}

/** Return header metadata cached by discovery; cwd remains in-memory only. */
export function readTraceHeader(trace: TraceDescriptor): TraceHeader {
  const header = cachedHeaders.get(trace)
  if (!header || !sourcePaths.has(trace))
    throw new Error('trace descriptor did not come from discoverTraces()')
  if ((header.cwd ?? '').toLowerCase().includes('dsh-oc')) throw new Error('excluded trace')
  return headerForRead(header)
}

/** Read and decode one selected trace. Never log or persist the returned events. */
export async function readTrace(trace: TraceDescriptor): Promise<ReadTrace> {
  const source = sourcePaths.get(trace)
  const discoveredHeader = cachedHeaders.get(trace)
  if (!source || !discoveredHeader)
    throw new Error('trace descriptor did not come from discoverTraces()')
  if ((discoveredHeader.cwd ?? '').toLowerCase().includes('dsh-oc'))
    throw new Error('excluded trace')
  const { path, root } = source
  if (isExcludedPath(path, root)) throw new Error('excluded trace')
  if (trace.compressedBytes > MAX_COMPRESSED_TRACE)
    throw new Error('trace exceeds compressed read cap')
  const bytes = await readFile(path)
  let frameCount = 0
  let uncompressedBytes = 0
  let storageRows = 0
  let packedRows = 0
  let tornTail = false
  let sequenceContinuous = true
  let expectedSeq = 0
  let header: HeaderRecord | undefined
  const events: TraceEvent[] = []
  let pending = Buffer.alloc(0)

  const consume = (plain: Buffer): void => {
    uncompressedBytes += plain.length
    if (uncompressedBytes > MAX_UNCOMPRESSED_TRACE)
      throw new Error('trace exceeds uncompressed read cap')
    const combined = pending.length ? Buffer.concat([pending, plain]) : plain
    let start = 0
    for (
      let newline = combined.indexOf(0x0a);
      newline !== -1;
      newline = combined.indexOf(0x0a, start)
    ) {
      const line = combined.subarray(start, newline)
      start = newline + 1
      if (!header) {
        header = parseHeader(Buffer.concat([line, Buffer.from('\n')]))
        continue
      }
      if (line.length === 0) continue
      storageRows++
      const parsed: unknown = JSON.parse(line.toString('utf8'))
      if (typeof parsed === 'object' && parsed !== null) {
        const expanded = decodePackedRow(parsed as Record<string, unknown>)
        if (expanded) {
          packedRows++
          for (const event of expanded) {
            if (event.seq !== expectedSeq) sequenceContinuous = false
            expectedSeq = event.seq + 1
            events.push(event)
          }
          continue
        }
      }
      const event = parsed as TraceEvent
      if (typeof event?.seq === 'number') {
        if (event.seq !== expectedSeq) sequenceContinuous = false
        expectedSeq = event.seq + 1
      } else {
        sequenceContinuous = false
      }
      events.push(event)
    }
    pending = Buffer.from(combined.subarray(start))
  }

  if (trace.encoding === 'zstd') {
    let offset = 0
    while (offset < bytes.length) {
      const end = firstFrameEnd(bytes.subarray(offset))
      if (end === undefined) {
        tornTail = true
        break
      }
      const frame = bytes.subarray(offset, offset + end)
      const plain = zstdDecompressSync(frame, { maxOutputLength: MAX_UNCOMPRESSED_TRACE })
      frameCount++
      consume(plain)
      offset += end
    }
  } else {
    frameCount = 1
    consume(bytes)
  }
  if (pending.length > 0) tornTail = true
  if (!header) throw new Error('trace has no valid header')
  if ((header.cwd ?? '').toLowerCase().includes('dsh-oc')) throw new Error('excluded trace')
  if (header.version !== trace.headerVersion || hashId(header.id) !== trace.sessionHash) {
    throw new Error('trace changed after header discovery')
  }
  return {
    sessionHash: trace.sessionHash,
    header: headerForRead(header),
    events,
    source: {
      encoding: trace.encoding,
      fileFamily: trace.fileFamily,
      compressedBytes: bytes.length,
      uncompressedBytes,
      frameCount,
      storageRows,
      packedRows,
      complete: !tornTail && sequenceContinuous,
      tornTail,
      sequenceContinuous,
    },
  }
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}

type CostMetric =
  | 'userBodyTextChars'
  | 'assistantBodyTextChars'
  | 'reasoningChars'
  | 'toolCallArgumentChars'
  | 'toolResultBodyTextChars'

type BodyKind = 'user' | 'assistant' | 'tool-result'
type CostTotals = Record<CostMetric, number> & {
  nonTextBlocks: number
  toolResultWrapperBlocks: number
  nonTextUserBlocks: number
  nonTextAssistantBlocks: number
  nonTextToolResultBlocks: number
}

interface TurnCost {
  turn: number
  steps: number
  content: CostTotals
}

interface SampleTraceAudit {
  read: ReadTrace
  turns: TurnCost[]
  content: CostTotals
  missingMessageContent: number
}

const COST_METRICS: readonly CostMetric[] = [
  'userBodyTextChars',
  'assistantBodyTextChars',
  'reasoningChars',
  'toolCallArgumentChars',
  'toolResultBodyTextChars',
]

function emptyCostTotals(): CostTotals {
  return {
    userBodyTextChars: 0,
    assistantBodyTextChars: 0,
    reasoningChars: 0,
    toolCallArgumentChars: 0,
    toolResultBodyTextChars: 0,
    nonTextBlocks: 0,
    toolResultWrapperBlocks: 0,
    nonTextUserBlocks: 0,
    nonTextAssistantBlocks: 0,
    nonTextToolResultBlocks: 0,
  }
}

function addCostTotals(target: CostTotals, delta: CostTotals): void {
  for (const key of Object.keys(target) as (keyof CostTotals)[]) target[key] += delta[key]
}

function countChars(value: string): number {
  let count = 0
  for (let i = 0; i < value.length; i++, count++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) i++
    }
  }
  return count
}

function bodyTextMetric(body: BodyKind): CostMetric {
  return body === 'user'
    ? 'userBodyTextChars'
    : body === 'assistant'
      ? 'assistantBodyTextChars'
      : 'toolResultBodyTextChars'
}

function countContentTree(value: unknown, body: BodyKind, totals: CostTotals, depth = 0): void {
  if (depth > 64 || value === null || value === undefined) return
  if (typeof value === 'string') {
    totals[bodyTextMetric(body)] += countChars(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) countContentTree(item, body, totals, depth + 1)
    return
  }
  if (typeof value !== 'object') return

  const block = value as Record<string, unknown>
  const type = typeof block.type === 'string' ? block.type : undefined
  if (type === 'text') {
    if (typeof block.text === 'string') totals[bodyTextMetric(body)] += countChars(block.text)
  } else if (type === 'reasoning') {
    if (typeof block.text === 'string') totals.reasoningChars += countChars(block.text)
  } else if (type === 'tool-call') {
    if (typeof block.arguments === 'string')
      totals.toolCallArgumentChars += countChars(block.arguments)
  } else {
    if (type !== undefined) {
      totals.nonTextBlocks++
      if (type === 'tool-result') totals.toolResultWrapperBlocks++
      if (body === 'user') totals.nonTextUserBlocks++
      else if (body === 'assistant') totals.nonTextAssistantBlocks++
      else totals.nonTextToolResultBlocks++
    } else {
      // A few flat historical shapes omit the type tag but retain the field.
      if (typeof block.text === 'string') totals[bodyTextMetric(body)] += countChars(block.text)
      if (typeof block.reasoning === 'string')
        totals.reasoningChars += countChars(block.reasoning)
      if (typeof block.arguments === 'string')
        totals.toolCallArgumentChars += countChars(block.arguments)
    }
  }

  // Visit only content-tree containers. This excludes stream deltas, arbitrary
  // event fields, and JSON wrappers from message-cost accounting.
  for (const key of ['content', 'blocks', 'parts', 'items', 'children']) {
    if (Object.hasOwn(block, key)) countContentTree(block[key], body, totals, depth + 1)
  }
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function analyzeSampleTrace(read: ReadTrace): SampleTraceAudit {
  const content = emptyCostTotals()
  const turns = new Map<number, TurnCost>()
  let currentTurn: number | undefined
  let missingMessageContent = 0
  const getTurn = (number: number | undefined): TurnCost | undefined => {
    if (number === undefined || !Number.isSafeInteger(number)) return undefined
    let turn = turns.get(number)
    if (!turn) {
      turn = { turn: number, steps: 0, content: emptyCostTotals() }
      turns.set(number, turn)
    }
    return turn
  }

  for (const event of read.events) {
    const data = recordOf(event.data)
    if (event.type === 'turn/start') {
      currentTurn = typeof data?.turn === 'number' ? data.turn : currentTurn
      getTurn(currentTurn)
      continue
    }
    const turn = getTurn(typeof data?.turn === 'number' ? data.turn : currentTurn)
    if (event.type === 'step/start') {
      if (turn) turn.steps++
      continue
    }
    if (
      event.type !== 'user/message' &&
      event.type !== 'assistant/message' &&
      event.type !== 'tool/result'
    )
      continue

    const delta = emptyCostTotals()
    if (event.type === 'user/message') {
      if (data?.content === undefined) missingMessageContent++
      else countContentTree(data.content, 'user', delta)
    } else {
      const message = recordOf(data?.message)
      if (message?.content === undefined) missingMessageContent++
      else
        countContentTree(
          message.content,
          event.type === 'assistant/message' ? 'assistant' : 'tool-result',
          delta,
        )
    }
    addCostTotals(content, delta)
    if (turn) addCostTotals(turn.content, delta)
  }
  return { read, turns: [...turns.values()], content, missingMessageContent }
}

function summarizeStepTurns(audits: readonly SampleTraceAudit[]) {
  const turns = audits.flatMap((audit) => audit.turns)
  const counts = turns.map((turn) => turn.steps)
  const above = (threshold: number) => {
    const count = counts.filter((value) => value > threshold).length
    return { count, share: counts.length ? count / counts.length : 0 }
  }
  return {
    sessions: audits.length,
    distinctSessionIds: new Set(audits.map((audit) => audit.read.sessionHash)).size,
    turns: turns.length,
    stepCountPerTurn: {
      p50: quantile(counts, 0.5),
      p90: quantile(counts, 0.9),
      max: Math.max(0, ...counts),
      zeroStepTurns: counts.filter((count) => count === 0).length,
      over20: above(20),
      over50: above(50),
      over100: above(100),
    },
  }
}

function summarizeContentCosts(audits: readonly SampleTraceAudit[]) {
  const total = emptyCostTotals()
  const tail = emptyCostTotals()
  const perSessionTailShare: number[] = []
  for (const audit of audits) {
    addCostTotals(total, audit.content)
    const tailTurns = new Set(audit.turns.slice(-2).map((turn) => turn.turn))
    const tailContent = emptyCostTotals()
    for (const turn of audit.turns) {
      if (tailTurns.has(turn.turn)) addCostTotals(tailContent, turn.content)
    }
    addCostTotals(tail, tailContent)
    const fullChars = COST_METRICS.reduce((sum, key) => sum + audit.content[key], 0)
    const tailChars = COST_METRICS.reduce((sum, key) => sum + tailContent[key], 0)
    if (fullChars) perSessionTailShare.push(tailChars / fullChars)
  }
  const fullChars = COST_METRICS.reduce((sum, key) => sum + total[key], 0)
  const tailChars = COST_METRICS.reduce((sum, key) => sum + tail[key], 0)
  return {
    characterUnit: 'Unicode code points',
    categories: Object.fromEntries(
      COST_METRICS.map((key) => [
        key,
        {
          chars: total[key],
          share: fullChars ? total[key] / fullChars : 0,
          lastTwoTurnChars: tail[key],
          lastTwoTurnShareOfCategory: total[key] ? tail[key] / total[key] : 0,
        },
      ]),
    ),
    totalTextAndArgumentsChars: fullChars,
    nonTextBlocks: {
      total: total.nonTextBlocks,
      toolResultWrappers: total.toolResultWrapperBlocks,
      otherTaggedNonTextBlocks: total.nonTextBlocks - total.toolResultWrapperBlocks,
      inUserMessages: total.nonTextUserBlocks,
      inAssistantMessages: total.nonTextAssistantBlocks,
      inToolResults: total.nonTextToolResultBlocks,
    },
    allCategoryLastTwoTurnShare: fullChars ? tailChars / fullChars : 0,
    perSessionLastTwoTurnShare: {
      p50: quantile(perSessionTailShare, 0.5),
      p90: quantile(perSessionTailShare, 0.9),
      max: Math.max(0, ...perSessionTailShare),
      sessionsWithText: perSessionTailShare.length,
    },
    missingMessageContentEvents: audits.reduce(
      (sum, audit) => sum + audit.missingMessageContent,
      0,
    ),
    method:
      'final user/message data.content, assistant/message data.message.content, tool/result data.message.content; recursive text/reasoning/tool-call.arguments only; excludes stream, assistant/chunk, and event JSON wrappers; non-text count includes tool-result wrappers, reported separately',
    interpretation:
      'last-two-turn share is append-only message-body concentration, not final replay surface or request token cost',
  }
}

function summarizeLineage(audits: readonly SampleTraceAudit[]) {
  const isChild = (audit: SampleTraceAudit) =>
    Boolean(
      audit.read.header.parentSessionHash ||
      audit.read.header.origin === 'subagent' ||
      audit.read.header.delegationDepth > 0,
    )
  const hasSeed = (audit: SampleTraceAudit) => (audit.read.header.seedLength ?? 0) > 0
  const subsets = {
    root: audits.filter((audit) => !isChild(audit)),
    child: audits.filter(isChild),
    seedBacked: audits.filter(hasSeed),
    noNonzeroSeed: audits.filter((audit) => !hasSeed(audit)),
  }
  return Object.fromEntries(
    Object.entries(subsets).map(([name, subset]) => [
      name,
      {
        samples: subset.length,
        distinctSessionIds: new Set(subset.map((audit) => audit.read.sessionHash)).size,
        stepTurns: summarizeStepTurns(subset),
        ...(name === 'seedBacked'
          ? {
              seedLength: {
                p50: quantile(
                  subset.map((audit) => audit.read.header.seedLength ?? 0),
                  0.5,
                ),
                p90: quantile(
                  subset.map((audit) => audit.read.header.seedLength ?? 0),
                  0.9,
                ),
                max: Math.max(0, ...subset.map((audit) => audit.read.header.seedLength ?? 0)),
              },
            }
          : {}),
      },
    ]),
  )
}

function analyzeDetailedSample(selected: readonly { sample: TraceSample; read: ReadTrace }[]) {
  const audits = selected.map(({ read }) => analyzeSampleTrace(read))
  return {
    versionedSampleCopies: audits.length,
    distinctSampleSessionIds: new Set(audits.map((audit) => audit.read.sessionHash)).size,
    sessionLineage: summarizeLineage(audits),
    stepTurns: summarizeStepTurns(audits),
    contentCosts: summarizeContentCosts(audits),
  }
}

function summarize(
  traces: readonly TraceDescriptor[],
  samples: readonly TraceSample[],
  reads: readonly ReadTrace[],
) {
  const byVersion = new Map<number, TraceDescriptor[]>()
  const logicalVersions = new Map<string, TraceDescriptor>()
  const filePriority = (trace: TraceDescriptor): number =>
    trace.fileFamily === 'v3' ? 2 : trace.fileFamily === 'base' ? 1 : 0
  for (const trace of traces) {
    const key = `${trace.sessionHash}:${trace.headerVersion}`
    const previous = logicalVersions.get(key)
    if (
      !previous ||
      filePriority(trace) > filePriority(previous) ||
      (filePriority(trace) === filePriority(previous) &&
        trace.modifiedAt > previous.modifiedAt) ||
      (filePriority(trace) === filePriority(previous) &&
        trace.modifiedAt === previous.modifiedAt &&
        trace.compressedBytes > previous.compressedBytes)
    )
      logicalVersions.set(key, trace)
  }
  for (const trace of logicalVersions.values()) {
    const group = byVersion.get(trace.headerVersion) ?? []
    group.push(trace)
    byVersion.set(trace.headerVersion, group)
  }
  const readByHash = new Map(
    reads.map((read) => [`${read.sessionHash}:${read.header.version}`, read]),
  )
  const allSelected = samples
    .map((sample) => ({
      sample,
      read: readByHash.get(`${sample.trace.sessionHash}:${sample.trace.headerVersion}`),
    }))
    .filter((item): item is { sample: TraceSample; read: ReadTrace } => item.read !== undefined)
  const uniqueSelected = new Map<string, { sample: TraceSample; read: ReadTrace }>()
  for (const item of allSelected) {
    const previous = uniqueSelected.get(item.read.sessionHash)
    if (
      !previous ||
      (item.read.source.fileFamily === 'v3' && previous.read.source.fileFamily !== 'v3') ||
      (item.read.source.fileFamily === previous.read.source.fileFamily &&
        item.read.header.version > previous.read.header.version)
    )
      uniqueSelected.set(item.read.sessionHash, item)
  }
  const sampleSummaries = [...byVersion.entries()]
    .sort(([a], [b]) => a - b)
    .map(([version, group]) => {
      const chosen = samples.filter((sample) => sample.trace.headerVersion === version)
      const selected = chosen
        .map((sample) => ({
          sample,
          read: readByHash.get(`${sample.trace.sessionHash}:${version}`),
        }))
        .filter(
          (item): item is { sample: TraceSample; read: ReadTrace } => item.read !== undefined,
        )
      const allContentLengths: number[] = []
      let userMessages = 0
      let assistantMessages = 0
      let toolResults = 0
      let turns = 0
      let steps = 0
      let events = 0
      let packed = 0
      let complete = 0
      for (const { read } of selected) {
        for (const event of read.events) {
          events++
          if (event.type === 'turn/start') turns++
          if (event.type === 'step/start') steps++
          if (event.type === 'user/message') userMessages++
          if (event.type === 'assistant/message') assistantMessages++
          if (event.type === 'tool/result') toolResults++
          if (
            event.type === 'user/message' ||
            event.type === 'assistant/message' ||
            event.type === 'tool/result'
          ) {
            allContentLengths.push(Buffer.byteLength(JSON.stringify(event.data ?? {}), 'utf8'))
          }
        }
        packed += read.source.packedRows
        if (read.source.complete) complete++
      }
      const uncompressedLogBytes = selected.reduce(
        (sum, { read }) => sum + read.source.uncompressedBytes,
        0,
      )
      const serializedMessageDataBytes = allContentLengths.reduce(
        (sum, value) => sum + value,
        0,
      )
      const sessionsWithTurns = selected.map(
        ({ read }) => read.events.filter((event) => event.type === 'turn/start').length,
      )
      return {
        headerVersion: version,
        uniqueSessionVersions: group.length,
        sampledSessions: chosen.length,
        decodedSessions: selected.length,
        sizeBytes: {
          p50: quantile(
            group.map((trace) => trace.compressedBytes),
            0.5,
          ),
          p90: quantile(
            group.map((trace) => trace.compressedBytes),
            0.9,
          ),
          max: Math.max(0, ...group.map((trace) => trace.compressedBytes)),
        },
        createdAtMs: {
          min: Math.min(...group.map((trace) => trace.createdAt)),
          max: Math.max(...group.map((trace) => trace.createdAt)),
        },
        sampleContent: {
          events,
          turns,
          steps,
          userMessages,
          assistantMessages,
          toolResults,
          packedStorageRows: packed,
          completeSessions: complete,
          meanTurnsPerSession: sessionsWithTurns.length
            ? sessionsWithTurns.reduce((sum, count) => sum + count, 0) /
              sessionsWithTurns.length
            : 0,
          uncompressedPersistedLogBytes: uncompressedLogBytes,
          serializedFinalMessageEventDataBytes: serializedMessageDataBytes,
          serializedMessageDataToLogRatio: uncompressedLogBytes
            ? serializedMessageDataBytes / uncompressedLogBytes
            : 0,
          note: 'serialized event-data bytes are not replayed request-surface bytes or a context-window estimate',
          messageDataBytesP50: quantile(allContentLengths, 0.5),
          messageDataBytesP90: quantile(allContentLengths, 0.9),
        },
        detailedBehavior: analyzeDetailedSample(selected),
        sampleStrata: chosen.reduce<Record<string, number>>((counts, item) => {
          counts[item.stratum.split(':').slice(1, 2)[0] ?? 'unknown'] =
            (counts[item.stratum.split(':').slice(1, 2)[0] ?? 'unknown'] ?? 0) + 1
          return counts
        }, {}),
      }
    })
  const families = traces.reduce<Record<string, number>>((counts, trace) => {
    const key = `${trace.fileFamily}/v${trace.headerVersion}`
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
  const sizeDistribution = {
    totalCompressedBytes: traces.reduce((sum, trace) => sum + trace.compressedBytes, 0),
    over500KiB: traces.filter((trace) => trace.compressedBytes > 500 * 1024).length,
    over1MiB: traces.filter((trace) => trace.compressedBytes > 1024 * 1024).length,
    over5MiB: traces.filter((trace) => trace.compressedBytes > 5 * 1024 * 1024).length,
  }
  return {
    physicalTraceFiles: traces.length,
    uniqueLogicalSessionIds: new Set(traces.map((trace) => trace.sessionHash)).size,
    uniqueSessionVersionPairs: logicalVersions.size,
    families,
    sizeDistribution,
    byVersion: sampleSummaries,
    detailedBehavior: {
      versionedSampleCopies: allSelected.length,
      distinctSampleSessionIds: uniqueSelected.size,
      repeatedSessionCopiesAcrossVersions: allSelected.length - uniqueSelected.size,
      distinctSessionAnalysis: analyzeDetailedSample([...uniqueSelected.values()]),
    },
  }
}

async function main(): Promise<void> {
  const traces = await discoverTraces()
  const samples = selectStratifiedSample(traces, { perVersion: 30 })
  const reads: ReadTrace[] = []
  let oversized = 0
  for (const { trace } of samples) {
    try {
      reads.push(await readTrace(trace))
    } catch {
      oversized++
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    sampleDesign:
      'up to 30 per logical header version; compressed-size tertiles crossed with creation-time quantiles; largest file forced into each version group',
    guardrails: {
      excludesExistingFrontendProjects: true,
      maximumCompressedBytesPerRead: MAX_COMPRESSED_TRACE,
      maximumUncompressedBytesPerRead: MAX_UNCOMPRESSED_TRACE,
      skippedOrUnreadableSamples: oversized,
      rawContentPersisted: false,
      modelCalls: 0,
    },
    discovery: getDiscoveryStats(traces),
    summary: summarize(traces, samples, reads),
    sampleManifest: samples.map(({ trace, stratum }) => ({
      sessionHash: trace.sessionHash,
      headerVersion: trace.headerVersion,
      createdAt: trace.createdAt,
      compressedBytes: trace.compressedBytes,
      fileFamily: trace.fileFamily,
      stratum,
      decoded: reads.some(
        (read) =>
          read.sessionHash === trace.sessionHash && read.header.version === trace.headerVersion,
      ),
    })),
  }
  const outDir = join(process.cwd(), '.tmp-vitest', 'history-audit')
  await mkdir(outDir, { recursive: true })
  await writeFile(
    join(outDir, 'generic-summary.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  )
  const concise = {
    inventory: {
      physicalTraceFiles: report.summary.physicalTraceFiles,
      uniqueLogicalSessionIds: report.summary.uniqueLogicalSessionIds,
      byHeaderVersion: report.summary.byVersion.map((version) => ({
        version: version.headerVersion,
        samples: version.detailedBehavior.versionedSampleCopies,
        stepCountPerTurn: version.detailedBehavior.stepTurns.stepCountPerTurn,
        lineage: Object.fromEntries(
          Object.entries(version.detailedBehavior.sessionLineage).map(([name, value]) => [
            name,
            {
              samples: value.samples,
              stepCountPerTurn: value.stepTurns.stepCountPerTurn,
            },
          ]),
        ),
        contentShares: Object.fromEntries(
          Object.entries(version.detailedBehavior.contentCosts.categories).map(
            ([name, value]) => [
              name,
              {
                chars: value.chars,
                share: value.share,
                lastTwoTurnShareOfCategory: value.lastTwoTurnShareOfCategory,
              },
            ],
          ),
        ),
        lastTwoTurnShare: version.detailedBehavior.contentCosts.allCategoryLastTwoTurnShare,
        nonTextBlocks: version.detailedBehavior.contentCosts.nonTextBlocks,
      })),
      distinctSampleSessionIds: report.summary.detailedBehavior.distinctSampleSessionIds,
    },
    discovery: report.discovery,
    output: '.tmp-vitest/history-audit/generic-summary.json',
  }
  process.stdout.write(`${JSON.stringify(concise, null, 2)}\n`)
}

const entry = process.argv[1]
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) {
  await main()
}
