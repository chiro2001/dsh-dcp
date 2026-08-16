/**
 * M6.1 online KV-cache A/B (optional, real provider): same synthetic
 * transcript with DCP markers on vs off; records cache-read/input ratio.
 * Requires OPENCODE_GO_API_KEY (sourced from ~/litellm/.env by caller).
 */

import { OpenCodeGoAdapter } from '../tests/e2e-real/opencode-go-adapter.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

const apiKey = process.env.OPENCODE_GO_API_KEY
if (!apiKey) {
  console.log('kv-ab: OPENCODE_GO_API_KEY missing; skipping')
  process.exit(0)
}

const baseUrl = process.env.DSH_DCP_LLM_BASE_URL ?? 'https://opencode.ai/zen/go/v1'
const model = process.env.DSH_DCP_LLM_MODEL ?? 'deepseek-v4-flash'

function messages(markerOn: boolean): GenerateOptions['messages'] {
  const result: GenerateOptions['messages'] = []
  if (markerOn) {
    result.push(
      createUserMessage({
        content: [{ type: 'text', text: '<dcp-boundary ref="m0001" turn="1" step="1" />' }],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
    )
  }
  result.push(
    createUserMessage({
      content: [{ type: 'text', text: 'Project: dynamic context pruning integration test.' }],
      source: { kind: 'user' },
    }),
  )
  if (markerOn) {
    result.push(
      createUserMessage({
        content: [{ type: 'text', text: '<dcp-boundary ref="m0002" turn="2" step="1" />' }],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
    )
  }
  result.push(
    createUserMessage({
      content: [{ type: 'text', text: 'Second turn: summarize the first turn.' }],
      source: { kind: 'user' },
    }),
  )
  return result
}

async function measure(
  markerOn: boolean,
  adapter: OpenCodeGoAdapter,
): Promise<{
  inputTokens: number
  cacheReadTokens: number
  firstTokenMs: number
}> {
  const started = Date.now()
  let usage: { inputTokens: number; cacheReadTokens: number } | undefined
  let sawDelta = false
  for await (const chunk of adapter.stream({
    provider: 'go',
    model,
    messages: messages(markerOn),
    maxTokens: 32,
  })) {
    if (chunk.type === 'text-delta' && !sawDelta) {
      sawDelta = true
    }
    if (chunk.type === 'usage') {
      usage = {
        inputTokens: chunk.usage.inputTokens,
        cacheReadTokens: chunk.usage.cacheReadTokens ?? 0,
      }
    }
  }
  return {
    inputTokens: usage?.inputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    firstTokenMs: Date.now() - started,
  }
}

const adapter = new OpenCodeGoAdapter({ baseUrl, apiKey, model })
// Warmup both variants, then measure each twice.
await measure(false, adapter)
await measure(true, adapter)
const off = [await measure(false, adapter), await measure(false, adapter)]
const on = [await measure(true, adapter), await measure(true, adapter)]

const summarize = (rows: Array<{ inputTokens: number; cacheReadTokens: number }>) => {
  const medianCache = rows
    .map((r) => r.cacheReadTokens / Math.max(1, r.inputTokens))
    .sort((a, b) => a - b)[Math.floor(rows.length / 2)]
  return {
    medianCacheRatio: Number((medianCache * 100).toFixed(1)),
    rows,
  }
}

const offSummary = summarize(off)
const onSummary = summarize(on)
console.log('kv-ab DCP off:', JSON.stringify(offSummary))
console.log('kv-ab DCP on :', JSON.stringify(onSummary))
const delta = onSummary.medianCacheRatio - offSummary.medianCacheRatio
if (!Number.isFinite(delta) || on.every((row) => row.cacheReadTokens === 0)) {
  console.log('kv-ab: INCONCLUSIVE (provider cache metrics absent/unstable)')
} else {
  console.log(`kv-ab: marker cache-read ratio delta ${delta.toFixed(1)}pp`)
}
