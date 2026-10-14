import { describe, expect, it } from 'vitest'
import {
  extractPromptSamples,
  normalizePromptUsage,
  summarizePromptTokens,
} from '../../scripts/history-context-metrics.js'

type SyntheticEvent = {
  seq: number
  type: string
  data?: Record<string, unknown>
  surfaceOp?: unknown
}

function event(
  seq: number,
  type: string,
  data: Record<string, unknown> = {},
  surfaceOp?: unknown,
): SyntheticEvent {
  return { seq, type, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) }
}

function usageChunk(usage: Record<string, unknown>) {
  return { type: 'usage', usage }
}

function streamUsage(usage: Record<string, unknown>) {
  return { type: 'chunk', chunk: usageChunk(usage) }
}

describe('history context metrics', () => {
  describe('normalizePromptUsage', () => {
    it('uses total minus output as prompt size without adding cache tokens twice', () => {
      expect(
        normalizePromptUsage({
          inputTokens: 70_000,
          cacheReadTokens: 20_000,
          outputTokens: 10_000,
          totalTokens: 100_000,
        }),
      ).toMatchObject({
        promptTokens: 90_000,
        lowerBoundTokens: 90_000,
        method: 'exact_total',
        cacheReadTokens: 20_000,
        reason: null,
      })
    })

    it('sums the validated disjoint buckets when totalTokens is unavailable', () => {
      expect(
        normalizePromptUsage({
          inputTokens: 40,
          cacheReadTokens: 30,
          cacheWriteTokens: 10,
          outputTokens: 20,
        }),
      ).toMatchObject({
        promptTokens: 80,
        lowerBoundTokens: 80,
        method: 'known_disjoint_buckets',
        cacheReadTokens: 30,
        reason: null,
      })
    })

    it('uses total minus output even when the input bucket is absent', () => {
      expect(normalizePromptUsage({ totalTokens: 100, outputTokens: 10 })).toMatchObject({
        promptTokens: 90,
        lowerBoundTokens: 90,
        method: 'exact_total',
        cacheReadTokens: null,
        reason: null,
      })
    })

    it('preserves the known input lower bound when all cache buckets are absent', () => {
      expect(normalizePromptUsage({ inputTokens: 47, outputTokens: 9 })).toMatchObject({
        promptTokens: null,
        lowerBoundTokens: 47,
        method: 'unavailable',
        cacheReadTokens: null,
      })
    })

    it('rejects a total that contradicts the known disjoint prompt buckets', () => {
      expect(
        normalizePromptUsage({
          inputTokens: 80,
          cacheReadTokens: 30,
          outputTokens: 20,
          totalTokens: 100,
        }),
      ).toMatchObject({
        promptTokens: null,
        lowerBoundTokens: null,
        method: 'unavailable',
        cacheReadTokens: 30,
      })
      expect(
        normalizePromptUsage({
          inputTokens: 80,
          cacheReadTokens: 30,
          outputTokens: 20,
          totalTokens: 100,
        }).reason,
      ).toEqual(expect.any(String))
    })

    it('does not invent prompt or cache counts when usage fields are missing', () => {
      expect(normalizePromptUsage(undefined)).toMatchObject({
        promptTokens: null,
        lowerBoundTokens: null,
        method: 'unavailable',
        cacheReadTokens: null,
      })
      expect(normalizePromptUsage({ outputTokens: 12 })).toMatchObject({
        promptTokens: null,
        lowerBoundTokens: null,
        method: 'unavailable',
        cacheReadTokens: null,
      })
    })
  })

  describe('extractPromptSamples', () => {
    it('takes only the last v0 usage chunk in an attempt and ignores its message copy', () => {
      const events = [
        event(1, 'assistant/header'),
        event(2, 'assistant/chunk', {
          chunk: usageChunk({ inputTokens: 50, outputTokens: 5, cacheReadTokens: 0 }),
        }),
        event(3, 'assistant/chunk', {
          chunk: usageChunk({ inputTokens: 90, outputTokens: 5, cacheReadTokens: 25 }),
        }),
        event(
          4,
          'assistant/message',
          { usage: { inputTokens: 90, outputTokens: 5, cacheReadTokens: 25 } },
          'append',
        ),
      ]

      const result = extractPromptSamples(events)
      expect(result.samples).toHaveLength(1)
      expect(result.samples[0]).toMatchObject({
        seq: 3,
        promptTokens: 115,
        method: 'known_disjoint_buckets',
      })
    })

    it('keeps retry headers as separate calls instead of summing their context', () => {
      const events = [
        event(1, 'assistant/header'),
        event(2, 'assistant/chunk', {
          chunk: usageChunk({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 }),
        }),
        event(3, 'assistant/header'),
        event(4, 'assistant/chunk', {
          chunk: usageChunk({ inputTokens: 120, outputTokens: 15, cacheReadTokens: 0 }),
        }),
        event(
          5,
          'assistant/message',
          { usage: { inputTokens: 220, outputTokens: 25, cacheReadTokens: 0 } },
          'append',
        ),
      ]

      const result = extractPromptSamples(events)
      expect(result.samples.map((sample) => sample.promptTokens)).toEqual([100, 120])
      expect(result.samples.map((sample) => sample.seq)).toEqual([2, 4])
    })

    it('does not mistake a later attempt settlement for an earlier chunk copy', () => {
      const events = [
        event(1, 'assistant/header'),
        event(2, 'assistant/chunk', {
          chunk: usageChunk({ inputTokens: 50, outputTokens: 5, cacheReadTokens: 0 }),
        }),
        event(3, 'assistant/chunk', { chunk: { type: 'finish' } }),
        event(4, 'assistant/header'),
        event(
          5,
          'assistant/message',
          { usage: { inputTokens: 90, outputTokens: 8, cacheReadTokens: 0 } },
          'append',
        ),
      ]

      expect(extractPromptSamples(events).samples.map((sample) => sample.promptTokens)).toEqual(
        [50, 90],
      )
    })

    it('ignores usage attached to arbitrary user, tool, or fake events', () => {
      const events = [
        event(
          1,
          'user/message',
          { usage: { inputTokens: 500_000, outputTokens: 1 } },
          'append',
        ),
        event(
          2,
          'tool/result',
          {
            message: { usage: { inputTokens: 600_000, outputTokens: 1 } },
          },
          'append',
        ),
        event(3, 'telemetry/fake-usage', {
          chunk: usageChunk({ inputTokens: 700_000, outputTokens: 1 }),
        }),
      ]

      expect(extractPromptSamples(events).samples).toEqual([])
    })

    it('ignores usage from inherited events before seedLength', () => {
      const events = [
        event(0, 'assistant/header'),
        event(1, 'assistant/chunk', {
          chunk: usageChunk({ inputTokens: 1_000_000, outputTokens: 1 }),
        }),
        event(2, 'assistant/header'),
        event(3, 'assistant/chunk', {
          chunk: usageChunk({ inputTokens: 80, outputTokens: 8, cacheReadTokens: 0 }),
        }),
      ]

      expect(
        extractPromptSamples(events, 2).samples.map((sample) => sample.promptTokens),
      ).toEqual([80])
    })

    it('uses the v3 embedded stream once and does not add the settle usage copy', () => {
      const events = [
        event(
          8,
          'assistant/message',
          {
            stream: [
              streamUsage({
                inputTokens: 100_000,
                outputTokens: 10_000,
                totalTokens: 180_000,
                cacheReadTokens: 70_000,
              }),
            ],
            usage: {
              inputTokens: 100_000,
              outputTokens: 10_000,
              totalTokens: 180_000,
              cacheReadTokens: 70_000,
            },
          },
          'append',
        ),
      ]

      const result = extractPromptSamples(events)
      expect(result.samples).toHaveLength(1)
      expect(result.samples[0]).toMatchObject({
        seq: 8,
        promptTokens: 170_000,
        method: 'exact_total',
      })
    })

    it('treats each embedded usage as a call when no header identifies request boundaries', () => {
      const events = [
        event(
          9,
          'assistant/message',
          {
            stream: [
              streamUsage({ inputTokens: 40, outputTokens: 4, cacheReadTokens: 0 }),
              streamUsage({ inputTokens: 60, outputTokens: 6, cacheReadTokens: 0 }),
            ],
            usage: { inputTokens: 100, outputTokens: 10 },
          },
          'append',
        ),
      ]

      expect(extractPromptSamples(events).samples.map((sample) => sample.promptTokens)).toEqual(
        [40, 60],
      )
    })

    it('ignores non-append assistant message copies', () => {
      const events = [
        event(
          10,
          'assistant/message',
          { stream: [streamUsage({ inputTokens: 300_000, outputTokens: 1 })] },
          { op: 'replace', startSeq: 1, endSeq: 2 },
        ),
        event(11, 'assistant/message', {
          stream: [streamUsage({ inputTokens: 400_000, outputTokens: 1 })],
          surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 },
        }),
      ]

      expect(extractPromptSamples(events).samples).toEqual([])
    })

    it('returns diagnostics alongside samples', () => {
      expect(extractPromptSamples([])).toMatchObject({
        samples: [],
        diagnostics: expect.any(Object),
      })
    })
  })

  describe('summarizePromptTokens', () => {
    it('uses nearest-rank percentiles and reports inclusive context thresholds', () => {
      const values = [99_999, 100_000, 200_000, 300_000, 500_000]
      expect(summarizePromptTokens(values)).toEqual({
        count: 5,
        mean: 239_999.8,
        p50: 200_000,
        p90: 500_000,
        p95: 500_000,
        max: 500_000,
        atLeast100k: 4,
        atLeast200k: 3,
        atLeast300k: 2,
        atLeast500k: 1,
      })
    })

    it('returns null statistics for an empty history', () => {
      expect(summarizePromptTokens([])).toEqual({
        count: 0,
        mean: null,
        p50: null,
        p90: null,
        p95: null,
        max: null,
        atLeast100k: 0,
        atLeast200k: 0,
        atLeast300k: 0,
        atLeast500k: 0,
      })
    })

    it('rejects negative token counts', () => {
      expect(() => summarizePromptTokens([0, -1])).toThrow()
    })
  })
})
