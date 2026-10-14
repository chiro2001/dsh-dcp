/** Numeric-only historical prompt accounting; never serialize private event payloads. */
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export interface PromptUsage {
  promptTokens: number | null
  lowerBoundTokens: number | null
  method: 'exact_total' | 'known_disjoint_buckets' | 'unavailable'
  cacheReadTokens: number | null
  reason: string | null
}

/** Historical DSH input/cache counts are disjoint; exact totals take priority. */
export function normalizePromptUsage(value: unknown): PromptUsage {
  const usage = object(value)
  const cacheReadTokens = count(usage?.cacheReadTokens) ? usage.cacheReadTokens : null
  const unavailable = (
    reason: string,
    lowerBoundTokens: number | null = null,
  ): PromptUsage => ({
    promptTokens: null,
    lowerBoundTokens,
    method: 'unavailable',
    cacheReadTokens,
    reason,
  })
  if (
    !usage ||
    !count(usage.outputTokens) ||
    (usage.inputTokens !== undefined && !count(usage.inputTokens))
  )
    return unavailable('missing_or_invalid_input_output')
  for (const key of ['cacheReadTokens', 'cacheWriteTokens'])
    if (usage[key] !== undefined && !count(usage[key]))
      return unavailable('invalid_cache_count')
  const known =
    ((usage.inputTokens as number) ?? 0) +
    (cacheReadTokens ?? 0) +
    ((usage.cacheWriteTokens as number) ?? 0)
  if (!count(known)) return unavailable('invalid_prompt_sum')
  if (usage.totalTokens !== undefined) {
    if (!count(usage.totalTokens) || usage.totalTokens < usage.outputTokens)
      return unavailable('invalid_total')
    const promptTokens = usage.totalTokens - usage.outputTokens
    if (
      promptTokens < known ||
      (usage.inputTokens !== undefined &&
        usage.cacheReadTokens !== undefined &&
        usage.cacheWriteTokens !== undefined &&
        promptTokens !== known)
    )
      return unavailable('inconsistent_total')
    return {
      promptTokens,
      lowerBoundTokens: promptTokens,
      method: 'exact_total',
      cacheReadTokens,
      reason: null,
    }
  }
  if (!count(usage.inputTokens)) return unavailable('missing_input')
  if (usage.cacheReadTokens === undefined && usage.cacheWriteTokens === undefined)
    return unavailable('cache_counts_unavailable', usage.inputTokens)
  // This is the recorded bucket sum, not an invented missing-provider counter.
  return {
    promptTokens: known,
    lowerBoundTokens: known,
    method: 'known_disjoint_buckets',
    cacheReadTokens,
    reason: null,
  }
}

interface NumericEvent {
  seq: number
  type: string
  data?: unknown
  surfaceOp?: unknown
}
export interface PromptSample extends PromptUsage {
  seq: number
}

/** Prefer physical stream usage; discard its settlement and replacement copies. */
export function extractPromptSamples(events: readonly NumericEvent[], seedLength = 0) {
  if (!count(seedLength)) throw new Error('Invalid inherited seed length')
  const samples: PromptSample[] = []
  const diagnostics = {
    inheritedEventsSkipped: 0,
    replacementMessagesSkipped: 0,
    streamUsageUpdatesCollapsed: 0,
    settlementCopiesSkipped: 0,
    standaloneSamples: 0,
    embeddedSamples: 0,
    settlementFallbackSamples: 0,
    ambiguousEmbeddedUsageGroups: 0,
  }
  let pending: { seq: number; usage: unknown } | undefined
  let standaloneSinceSettlement = false
  let standaloneFinished = false
  const add = (seq: number, usage: unknown) =>
    samples.push({ seq, ...normalizePromptUsage(usage) })
  const flush = () => {
    if (pending) {
      add(pending.seq, pending.usage)
      diagnostics.standaloneSamples++
      pending = undefined
    }
  }
  for (const event of events) {
    if (event.seq < seedLength) {
      diagnostics.inheritedEventsSkipped++
      continue
    }
    const data = object(event.data)
    const chunk = object(data?.chunk)
    if (
      event.type === 'assistant/header' ||
      (event.type === 'assistant/chunk' && chunk?.type === 'header')
    ) {
      flush()
      if (standaloneFinished) standaloneSinceSettlement = false
      standaloneFinished = false
      continue
    }
    if (event.type === 'assistant/chunk' && chunk?.type === 'usage') {
      if (pending) diagnostics.streamUsageUpdatesCollapsed++
      pending = { seq: event.seq, usage: chunk.usage }
      standaloneSinceSettlement = true
      continue
    }
    if (
      event.type === 'assistant/chunk' &&
      (chunk?.type === 'finish' || chunk?.type === 'finish-reason')
    ) {
      flush()
      standaloneFinished = true
      continue
    }
    if (event.type !== 'assistant/message') continue
    const op = event.surfaceOp ?? data?.surfaceOp
    if (op !== undefined && op !== 'append') {
      diagnostics.replacementMessagesSkipped++
      continue
    }
    flush()
    if (standaloneSinceSettlement) {
      diagnostics.settlementCopiesSkipped++
      standaloneSinceSettlement = false
      continue
    }
    const message = object(data?.message)
    const stream = data?.stream ?? message?.stream
    const chunks = Array.isArray(stream)
      ? stream
          .map((item) => object(object(item)?.chunk) ?? object(item))
          .filter((item) => item !== undefined)
      : []
    const usages = chunks.filter((item) => item.type === 'usage')
    if (usages.length) {
      if (!chunks.some((item) => item.type === 'header')) {
        if (usages.length > 1) diagnostics.ambiguousEmbeddedUsageGroups++
        for (const item of usages) {
          add(event.seq, item.usage)
          diagnostics.embeddedSamples++
        }
      } else {
        let embedded: unknown
        const emit = () => {
          if (embedded !== undefined) {
            add(event.seq, embedded)
            diagnostics.embeddedSamples++
            embedded = undefined
          }
        }
        for (const item of chunks) {
          if (item.type === 'header' || item.type === 'finish' || item.type === 'finish-reason')
            emit()
          if (item.type === 'usage') {
            if (embedded !== undefined) diagnostics.streamUsageUpdatesCollapsed++
            embedded = item.usage
          }
        }
        emit()
      }
      if (data?.usage !== undefined) diagnostics.settlementCopiesSkipped++
    } else if (data?.usage !== undefined) {
      add(event.seq, data.usage)
      diagnostics.settlementFallbackSamples++
    }
  }
  flush()
  return { samples, diagnostics }
}

export function summarizePromptTokens(values: readonly number[]) {
  if (values.some((value) => !count(value))) throw new Error('Invalid prompt token count')
  const sorted = values.toSorted((a, b) => a - b)
  const percentile = (q: number) =>
    sorted.length ? sorted[Math.ceil(q * sorted.length) - 1]! : null
  return {
    count: sorted.length,
    mean: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
    p50: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? null,
    atLeast100k: sorted.filter((value) => value >= 100_000).length,
    atLeast200k: sorted.filter((value) => value >= 200_000).length,
    atLeast300k: sorted.filter((value) => value >= 300_000).length,
    atLeast500k: sorted.filter((value) => value >= 500_000).length,
  }
}
