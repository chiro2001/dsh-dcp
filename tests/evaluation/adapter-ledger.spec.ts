import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTEXT_WINDOW_EXCEEDED_CODE, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { aggregate } from '../../scripts/evaluation/aggregate.js'
import { createLedger } from '../../scripts/evaluation/ledger.js'
import { prices, descriptor } from './helpers.js'
import { OpenCodeGoAdapter } from '../e2e-real/opencode-go-adapter.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

type AttemptEvent =
  | {
      phase: 'start'
      requestId: number
      startedAt: number
      requestHash: string
      model?: string
    }
  | {
      phase: 'finish'
      requestId: number
      startedAt: number
      finishedAt: number
      status: 'success' | 'http_error' | 'network_error' | 'invalid_response' | 'aborted'
      usage?: {
        uncachedInputTokens: number
        cacheReadTokens: number
        outputTokens: number
        reasoningTokens?: number
      }
      model?: string
      pricesTimestamp?: number
      providerCreated?: number
    }

const options = {
  provider: 'deepseek',
  model: 'deepseek-flash',
  messages: [
    createUserMessage({
      content: [{ type: 'text', text: 'Keep this request tied to the session log.' }],
      source: { kind: 'user' },
    }),
  ],
}

function adapter(onAttempt: (event: AttemptEvent) => void) {
  return new OpenCodeGoAdapter({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-only-redacted-key',
    onAttempt,
  })
}

async function drain(instance: OpenCodeGoAdapter): Promise<void> {
  for await (const chunk of instance.stream(options)) {
    // The observer is the tested surface; stream chunks are intentionally ignored.
    void chunk
  }
}

async function collect(instance: OpenCodeGoAdapter): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of instance.stream(options)) chunks.push(chunk)
  return chunks
}

async function drainAllowingInvalidResponse(instance: OpenCodeGoAdapter): Promise<void> {
  try {
    await drain(instance)
  } catch {
    // A malformed response may also fail the model stream; it must still close its attempt.
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function finishEvents(events: AttemptEvent[]): Extract<AttemptEvent, { phase: 'finish' }>[] {
  return events.filter(
    (event): event is Extract<AttemptEvent, { phase: 'finish' }> => event.phase === 'finish',
  )
}

describe('HTTP attempt observer and evaluation ledger', () => {
  it('emits a correlated, body-hashed request pair that can be booked into the run ledger', async () => {
    const body = {
      choices: [{ message: { content: 'completed' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 120,
        prompt_cache_hit_tokens: 20,
        completion_tokens: 30,
        completion_tokens_details: { reasoning_tokens: 4 },
      },
    }
    let requestBody = ''
    globalThis.fetch = async (_input, init) => {
      requestBody = String(init?.body)
      return jsonResponse(body)
    }

    const events: AttemptEvent[] = []
    const runStart = Date.now() - 1000
    const ledger = createLedger(
      descriptor({ runId: 'adapter-run', startedAt: runStart }),
      prices,
    )
    const attemptIds = new Map<number, string>()
    const instance = adapter((rawEvent) => {
      const event = rawEvent as AttemptEvent
      events.push(structuredClone(event))
      if (event.phase === 'start') {
        attemptIds.set(
          event.requestId,
          ledger.startAttempt({
            agentId: 'root-agent',
            sessionId: 'adapter-session',
            purpose: 'agent-turn',
            startedAt: event.startedAt,
            requestHash: event.requestHash,
          }),
        )
      } else {
        const attemptId = attemptIds.get(event.requestId)
        if (!attemptId) throw new Error('finish event has no matching start')
        ledger.finishAttempt(attemptId, {
          status: event.status,
          finishedAt: event.finishedAt,
          ...(event.usage === undefined ? {} : { usage: event.usage }),
          prices,
        })
      }
    })
    const originalMessages = structuredClone(options.messages)

    await drain(instance)

    expect(events.map((event) => event.phase)).toEqual(['start', 'finish'])
    const start = events[0] as Extract<AttemptEvent, { phase: 'start' }>
    const finish = events[1] as Extract<AttemptEvent, { phase: 'finish' }>
    expect(start.requestId).toBe(1)
    expect(finish.requestId).toBe(start.requestId)
    expect(start.requestHash).toBe(
      createHash('sha256').update(requestBody, 'utf8').digest('hex'),
    )
    expect(start.requestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(start.model).toBe('deepseek-flash')
    expect(finish).toMatchObject({
      phase: 'finish',
      status: 'success',
      startedAt: start.startedAt,
      model: 'deepseek-flash',
      usage: {
        uncachedInputTokens: 100,
        cacheReadTokens: 20,
        outputTokens: 30,
        reasoningTokens: 4,
      },
    })
    expect(finish.finishedAt).toBeGreaterThanOrEqual(finish.startedAt)
    expect(JSON.parse(requestBody)).toMatchObject({ messages: [{ role: 'user' }] })
    expect(options.messages).toEqual(originalMessages)

    const run = ledger.finishRun({ outcome: 'success', finishedAt: finish.finishedAt + 1 })
    expect(run.attempts).toHaveLength(1)
    expect(run.attempts[0]?.metadata.requestHash).toBe(start.requestHash)
    expect(run.usageComplete).toBe(true)
    expect(run.totalCost).toBeCloseTo((100 * 0.27 + 20 * 0.07 + 30 * 1.1) / 1_000_000, 14)
    expect(aggregate([run]).byArm.candidate.runCount).toBe(1)
  })

  it('does not invent missing cache usage, while accepting an explicit zero cache count', async () => {
    const events: AttemptEvent[] = []
    let responseIndex = 0
    globalThis.fetch = async () => {
      responseIndex++
      return jsonResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage:
          responseIndex === 1
            ? { prompt_tokens: 120, completion_tokens: 30 }
            : { prompt_tokens: 120, prompt_cache_hit_tokens: 0, completion_tokens: 30 },
      })
    }
    const instance = adapter((event) => events.push(structuredClone(event as AttemptEvent)))

    await drain(instance)
    await drain(instance)

    const finished = finishEvents(events)
    expect(finished).toHaveLength(2)
    expect(finished[0]).toMatchObject({ status: 'success' })
    expect(finished[0]?.usage).toBeUndefined()
    expect(finished[1]).toMatchObject({
      status: 'success',
      usage: { uncachedInputTokens: 120, cacheReadTokens: 0, outputTokens: 30 },
    })
    expect(
      events.filter((event) => event.phase === 'start').map((event) => event.requestId),
    ).toEqual([1, 2])
  })

  it.each([
    {
      label: 'HTTP errors',
      expectedStatus: 'http_error',
      fetch: async () => jsonResponse({ error: { message: 'rejected' } }, 429),
    },
    {
      label: 'network errors',
      expectedStatus: 'network_error',
      fetch: async () => {
        throw new TypeError('connection lost')
      },
    },
    {
      label: 'aborts',
      expectedStatus: 'aborted',
      fetch: async () => {
        throw new DOMException('request aborted', 'AbortError')
      },
    },
    {
      label: 'invalid JSON',
      expectedStatus: 'invalid_response',
      fetch: async () => new Response('{not-json', { status: 200 }),
    },
    {
      label: 'empty choices',
      expectedStatus: 'invalid_response',
      fetch: async () => jsonResponse({ choices: [], usage: { prompt_tokens: 20 } }),
    },
  ])(
    'records a finish event for $label without making the request disappear',
    async ({ expectedStatus, fetch }) => {
      const events: AttemptEvent[] = []
      globalThis.fetch = fetch
      const instance = adapter((event) => events.push(structuredClone(event as AttemptEvent)))

      await drainAllowingInvalidResponse(instance)

      expect(events.map((event) => event.phase)).toEqual(['start', 'finish'])
      const start = events[0] as Extract<AttemptEvent, { phase: 'start' }>
      const finish = events[1] as Extract<AttemptEvent, { phase: 'finish' }>
      expect(finish).toMatchObject({
        requestId: start.requestId,
        startedAt: start.startedAt,
        status: expectedStatus,
      })
      expect(finish.finishedAt).toBeGreaterThanOrEqual(finish.startedAt)
    },
  )

  it('retains complete usage from an invalid choice response because provider work was billed', async () => {
    const events: AttemptEvent[] = []
    globalThis.fetch = async () =>
      jsonResponse({
        choices: [],
        usage: {
          prompt_tokens: 50,
          prompt_cache_hit_tokens: 10,
          completion_tokens: 0,
        },
      })
    const instance = adapter((event) => events.push(structuredClone(event as AttemptEvent)))

    await drainAllowingInvalidResponse(instance)

    expect(finishEvents(events)[0]).toMatchObject({
      status: 'invalid_response',
      usage: { uncachedInputTokens: 40, cacheReadTokens: 10, outputTokens: 0 },
    })
  })

  it('fails fast if the ledger observer rejects either boundary event', async () => {
    let fetchCalls = 0
    globalThis.fetch = async () => {
      fetchCalls++
      return jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
    }
    const startFailure = adapter(() => {
      throw new Error('cannot write attempt start')
    })

    await expect(drain(startFailure)).rejects.toThrow('cannot write attempt start')
    expect(fetchCalls).toBe(0)

    const seenPhases: string[] = []
    const finishFailure = adapter((event) => {
      seenPhases.push((event as AttemptEvent).phase)
      if ((event as AttemptEvent).phase === 'finish')
        throw new Error('cannot write attempt finish')
    })
    await expect(drain(finishFailure)).rejects.toThrow('cannot write attempt finish')
    expect(fetchCalls).toBe(1)
    expect(seenPhases).toEqual(['start', 'finish'])
  })

  it('maps provider context overflow to the canonical retry code without treating quota as overflow', async () => {
    globalThis.fetch = async () =>
      jsonResponse(
        {
          error: {
            code: 'context_length_exceeded',
            type: 'invalid_request_error',
            message: 'The request exceeds the model context window.',
          },
        },
        400,
      )
    const overflowChunks = await collect(adapter(() => {}))
    const overflowFinish = overflowChunks.findLast((chunk) => chunk.type === 'finish')

    expect(overflowFinish).toMatchObject({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE, status: 400 },
      },
    })

    globalThis.fetch = async () =>
      jsonResponse(
        {
          error: {
            code: 'insufficient_quota',
            type: 'insufficient_quota',
            message: 'You exceeded your account quota.',
          },
        },
        400,
      )
    const quotaChunks = await collect(adapter(() => {}))
    const quotaFinish = quotaChunks.findLast((chunk) => chunk.type === 'finish')

    expect(quotaFinish).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'HTTP_ERROR', status: 400 } },
    })
  })
})
