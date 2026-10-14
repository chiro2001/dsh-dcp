import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { GenerateOptions, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { runTask } from '../../scripts/evaluation/harness.js'
import { descriptor } from './helpers.js'
import { OpenCodeGoAdapter } from '../e2e-real/opencode-go-adapter.js'
import type { RunRecord } from '../../scripts/evaluation/ledger.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

type RecordedRequest = {
  messages: GenerateOptions['messages']
  purpose?: GenerateOptions['purpose']
  eventsAtDispatch: SessionEvent[]
}

class ModelInfoAdapter extends OpenCodeGoAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      context: { contextWindow: 1_000_000 },
    }
  }
}

function completion(
  message: Record<string, unknown>,
  finishReason: string,
  usage = {
    prompt_tokens: 1000,
    prompt_cache_hit_tokens: 0,
    completion_tokens: 30,
  },
): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message, finish_reason: finishReason }],
      usage,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function terminalCall(id: string, command: string): Record<string, unknown> {
  return {
    tool_calls: [
      {
        id,
        type: 'function',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ command, timeoutSec: 5 }),
        },
      },
    ],
  }
}

async function createCwd(): Promise<string> {
  const parent = join(process.cwd(), '.tmp-vitest')
  await mkdir(parent, { recursive: true })
  return mkdtemp(join(parent, 'evaluation-harness-'))
}

function recordMessagesAgainstSession(requests: RecordedRequest[], sessionId: string): void {
  const loopRequests = requests.filter((request) => request.purpose !== 'compaction')
  expect(loopRequests.length).toBeGreaterThan(0)
  for (const request of loopRequests) {
    const atDispatch = Session.create(SessionId(sessionId), request.eventsAtDispatch)
    expect(JSON.stringify(request.messages)).toBe(JSON.stringify(atDispatch.deriveMessages()))
  }
}

function assistantText(events: readonly SessionEvent[]): string {
  return events
    .filter((event) => event.type === 'assistant/message')
    .flatMap((event) =>
      event.data.message.content.flatMap((block) =>
        block.type === 'text' ? [block.text] : [],
      ),
    )
    .join('\n')
}

function toolResultText(events: readonly SessionEvent[]): string[] {
  return events
    .filter((event) => event.type === 'tool/result')
    .map((event) =>
      event.data.message.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n'),
    )
}

describe('evaluation AgentLoop harness', () => {
  it('runs terminal work through production services and leaves success pending for the verifier', async () => {
    const cwd = await createCwd()
    const runDescriptor = descriptor({
      runId: 'terminal-ready-run',
      model: 'deepseek-flash',
      provider: 'deepseek',
      startedAt: Date.now(),
    })
    const observedEvents: SessionEvent[] = []
    const requests: RecordedRequest[] = []
    const terminalCalls: Array<{ command: string; timeoutSec: number; signal?: AbortSignal }> =
      []
    let fetchCount = 0
    let contextCompactionIsNative = false

    globalThis.fetch = async () => {
      fetchCount++
      if (fetchCount === 1) {
        return completion(
          terminalCall('write-ready', 'printf READY > result.txt'),
          'tool_calls',
        )
      }
      if (fetchCount === 2) return completion({ content: 'READY' }, 'stop')
      throw new Error('request budget test failed: an unexpected third HTTP request was sent')
    }

    try {
      const result = await runTask({
        descriptor: runDescriptor,
        adapterFactory: (onAttempt) => {
          const adapter = new ModelInfoAdapter({
            baseUrl: 'https://example.invalid/v1',
            apiKey: 'test-only-redacted-key',
            onAttempt,
          })
          const stream = adapter.stream.bind(adapter)
          adapter.stream = async function* (options: GenerateOptions) {
            requests.push({
              messages: structuredClone(options.messages),
              purpose: options.purpose,
              eventsAtDispatch: structuredClone(observedEvents),
            })
            yield* stream(options)
          } as typeof adapter.stream
          return adapter
        },
        maxRequests: 2,
        deadlineMs: 30_000,
        terminal: async (command, timeoutSec, signal) => {
          terminalCalls.push({ command, timeoutSec, signal })
          if (command !== 'printf READY > result.txt')
            throw new Error('unexpected terminal command')
          await writeFile(join(cwd, 'result.txt'), 'READY')
          return { stdout: 'READY', stderr: '', returnCode: 0 }
        },
        instruction: 'Write READY into result.txt using terminal, then reply with the result.',
        cwd,
        dcpEnabled: true,
        onSessionEvent: (event) => observedEvents.push(event),
        onContext: (context) => {
          contextCompactionIsNative = context.compaction instanceof BasicCompactionEngine
        },
      })

      expect(fetchCount).toBe(2)
      expect(result.execution).toMatchObject({ status: 'completed', requestCount: 2 })
      expect(result.verification).toBe('pending')
      expect(result.ledger.success).toBe(false)
      expect(result.ledger.outcome).not.toBe('success')
      expect(result.ledger.usageComplete).toBe(true)
      expect(result.nativeCompaction).toEqual({
        enabled: true,
        auto: true,
        contextWindow: 1_000_000,
      })
      expect(contextCompactionIsNative).toBe(true)
      expect(terminalCalls).toHaveLength(1)
      expect(terminalCalls[0]).toMatchObject({
        command: 'printf READY > result.txt',
        timeoutSec: 5,
      })
      expect(await readFile(join(cwd, 'result.txt'), 'utf8')).toBe('READY')
      expect(assistantText(result.events)).toContain('READY')
      expect(toolResultText(result.events).some((text) => text.includes('READY'))).toBe(true)
      expect(requests).toHaveLength(2)
      expect(requests[1]?.messages.some((message) => message.role === 'tool')).toBe(true)
      recordMessagesAgainstSession(requests, runDescriptor.runId)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('blocks a third model request before HTTP dispatch while retaining both tool receipts', async () => {
    const cwd = await createCwd()
    const runDescriptor = descriptor({
      runId: 'request-budget-run',
      model: 'deepseek-flash',
      provider: 'deepseek',
      startedAt: Date.now(),
    })
    const observedEvents: SessionEvent[] = []
    const requests: RecordedRequest[] = []
    const terminalCommands: string[] = []
    let fetchCount = 0

    globalThis.fetch = async () => {
      fetchCount++
      if (fetchCount === 1) {
        return completion(
          terminalCall('write-ready', 'printf READY > result.txt'),
          'tool_calls',
        )
      }
      if (fetchCount === 2)
        return completion(terminalCall('read-ready', 'cat result.txt'), 'tool_calls')
      throw new Error('request budget test failed: an unexpected third HTTP request was sent')
    }

    try {
      const result = await runTask({
        descriptor: runDescriptor,
        adapterFactory: (onAttempt) => {
          const adapter = new ModelInfoAdapter({
            baseUrl: 'https://example.invalid/v1',
            apiKey: 'test-only-redacted-key',
            onAttempt,
          })
          const stream = adapter.stream.bind(adapter)
          adapter.stream = async function* (options: GenerateOptions) {
            requests.push({
              messages: structuredClone(options.messages),
              purpose: options.purpose,
              eventsAtDispatch: structuredClone(observedEvents),
            })
            yield* stream(options)
          } as typeof adapter.stream
          return adapter
        },
        maxRequests: 2,
        deadlineMs: 30_000,
        terminal: async (command, timeoutSec) => {
          terminalCommands.push(command)
          if (timeoutSec !== 5)
            throw new Error('terminal timeout did not reach the container callback')
          if (command === 'printf READY > result.txt') {
            await writeFile(join(cwd, 'result.txt'), 'READY')
            return { stdout: 'READY', stderr: '', returnCode: 0 }
          }
          if (command === 'cat result.txt') {
            return {
              stdout: await readFile(join(cwd, 'result.txt'), 'utf8'),
              stderr: '',
              returnCode: 0,
            }
          }
          throw new Error('unexpected terminal command')
        },
        instruction: 'Write READY, read it back using terminal, then respond.',
        cwd,
        dcpEnabled: true,
        onSessionEvent: (event) => observedEvents.push(event),
      })

      expect(fetchCount).toBe(2)
      expect(result.execution).toMatchObject({ status: 'budget_exceeded', requestCount: 2 })
      expect(result.ledger).toMatchObject({ outcome: 'budget_exceeded', success: false })
      expect(terminalCommands).toEqual(['printf READY > result.txt', 'cat result.txt'])
      expect(requests).toHaveLength(2)
      expect(requests[1]?.messages.some((message) => message.role === 'tool')).toBe(true)
      expect(toolResultText(result.events)).toHaveLength(2)
      expect(toolResultText(result.events).every((text) => text.includes('READY'))).toBe(true)
      expect(result.events.filter((event) => event.type === 'tool/result')).toHaveLength(2)
      recordMessagesAgainstSession(requests, runDescriptor.runId)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('rejects an adapter without exact context metadata and records an infrastructure ledger', async () => {
    let fetchCount = 0
    globalThis.fetch = async () => {
      fetchCount++
      return completion({ content: 'must not be sent' }, 'stop')
    }
    const ledgerSnapshots: RunRecord[] = []

    await expect(
      runTask({
        descriptor: descriptor({
          runId: 'missing-context-run',
          model: 'deepseek-flash',
          provider: 'deepseek',
          startedAt: Date.now(),
        }),
        adapterFactory: (onAttempt) =>
          new OpenCodeGoAdapter({
            baseUrl: 'https://example.invalid/v1',
            apiKey: 'test-only-redacted-key',
            onAttempt,
          }),
        maxRequests: 1,
        deadlineMs: 30_000,
        terminal: async () => ({ stdout: '', stderr: '', returnCode: 0 }),
        instruction: 'This must fail before any model request.',
        cwd: process.cwd(),
        dcpEnabled: true,
        onLedger: (record) => ledgerSnapshots.push(structuredClone(record)),
      }),
    ).rejects.toThrow(/context metadata/)

    expect(fetchCount).toBe(0)
    const finalRecord = ledgerSnapshots.at(-1)
    expect(finalRecord).toMatchObject({
      outcome: 'infrastructure_error',
      success: false,
      attempts: [],
      totalCost: null,
      usageComplete: false,
    })
  })

  it('finalizes an unknown-cost failure record when an attempt observer throws', async () => {
    const cwd = await createCwd()
    let fetchCount = 0
    globalThis.fetch = async () => {
      fetchCount++
      return completion({ content: 'must not be sent' }, 'stop')
    }
    const ledgerSnapshots: RunRecord[] = []
    let returned: Awaited<ReturnType<typeof runTask>> | undefined
    let thrown: unknown

    try {
      returned = await runTask({
        descriptor: descriptor({
          runId: 'observer-error-run',
          model: 'deepseek-flash',
          provider: 'deepseek',
          startedAt: Date.now(),
        }),
        adapterFactory: (onAttempt) =>
          new ModelInfoAdapter({
            baseUrl: 'https://example.invalid/v1',
            apiKey: 'test-only-redacted-key',
            onAttempt: (event) => {
              onAttempt(event)
              if (event.phase === 'start') throw new Error('observer sink failed')
            },
          }),
        maxRequests: 1,
        deadlineMs: 30_000,
        terminal: async () => ({ stdout: '', stderr: '', returnCode: 0 }),
        instruction: 'The observer error must stop this request before HTTP dispatch.',
        cwd,
        dcpEnabled: true,
        onLedger: (record) => ledgerSnapshots.push(structuredClone(record)),
      })
    } catch (error) {
      thrown = error
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }

    expect(fetchCount).toBe(0)
    const finalRecord =
      returned?.ledger ?? ledgerSnapshots.findLast((record) => record.outcome !== null)
    expect(finalRecord).toBeDefined()
    if (!finalRecord) throw new Error('run did not expose its final failure ledger')
    expect(['failure', 'infrastructure_error']).toContain(finalRecord.outcome)
    expect(finalRecord.success).toBe(false)
    expect(finalRecord.attempts).toHaveLength(1)
    expect(finalRecord.attempts[0]).toMatchObject({
      status: 'aborted',
      usage: null,
      cost: null,
    })
    expect(finalRecord.usageComplete).toBe(false)
    expect(finalRecord.totalCost).toBeNull()
    if (thrown !== undefined) expect(String(thrown)).toContain('observer sink failed')
  })

  it('keeps overflow usage unknown but allows one native summary and bounded retry', async () => {
    const cwd = await createCwd()
    const runDescriptor = descriptor({
      runId: 'unknown-cost-overflow-run',
      model: 'deepseek-flash',
      provider: 'deepseek',
      startedAt: Date.now(),
    })
    const observedEvents: SessionEvent[] = []
    const requests: RecordedRequest[] = []
    const fetchPurposes: Array<GenerateOptions['purpose']> = []
    let fetchCount = 0
    let conversationCount = 0
    const evidencePreamble = Array.from(
      { length: 60 },
      (_, index) =>
        `Evidence item ${index}: source manifest package-${index} records checksum ${index.toString(16)} and confirms rollback remains available before deployment.`,
    ).join('\n')
    const longTerminalOutput =
      'routine event status ok; verify checksum before rollout\n'.repeat(1000)

    globalThis.fetch = async () => {
      fetchCount++
      const purpose = fetchPurposes.shift()
      if (purpose === 'compaction') {
        return completion(
          {
            content:
              'Checkpoint: preserve rollback requirements and verify the current artifact before release.',
          },
          'stop',
          {
            prompt_tokens: 150_000,
            prompt_cache_hit_tokens: 0,
            completion_tokens: 100,
          },
        )
      }
      if (purpose !== undefined) throw new Error(`unexpected LLM purpose ${purpose}`)
      conversationCount++
      if (conversationCount === 1) {
        return completion(terminalCall('read-history', 'cat run.log'), 'tool_calls')
      }
      if (conversationCount === 2) {
        return completion(
          terminalCall('write-ready', 'printf READY > result.txt'),
          'tool_calls',
        )
      }
      if (conversationCount === 3) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'context_length_exceeded',
              type: 'invalid_request_error',
              message: 'The request exceeds the model context window.',
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }
      if (conversationCount === 4) {
        return completion({ content: 'READY' }, 'stop', {
          prompt_tokens: 5_000,
          prompt_cache_hit_tokens: 0,
          completion_tokens: 30,
        })
      }
      throw new Error('context overflow retry did not terminate after one successful recovery')
    }

    try {
      const result = await runTask({
        descriptor: runDescriptor,
        adapterFactory: (onAttempt) => {
          const adapter = new ModelInfoAdapter({
            baseUrl: 'https://example.invalid/v1',
            apiKey: 'test-only-redacted-key',
            onAttempt,
          })
          const stream = adapter.stream.bind(adapter)
          adapter.stream = async function* (options: GenerateOptions) {
            requests.push({
              messages: structuredClone(options.messages),
              purpose: options.purpose,
              eventsAtDispatch: structuredClone(observedEvents),
            })
            fetchPurposes.push(options.purpose)
            yield* stream(options)
          } as typeof adapter.stream
          return adapter
        },
        maxRequests: 5,
        maxCostUSD: 0.3,
        deadlineMs: 60_000,
        terminal: async (command) => {
          if (command === 'cat run.log') {
            return { stdout: longTerminalOutput, stderr: '', returnCode: 0 }
          }
          if (command === 'printf READY > result.txt') {
            return { stdout: 'READY', stderr: '', returnCode: 0 }
          }
          throw new Error('unexpected terminal command')
        },
        instruction: `${evidencePreamble}\nInspect the synthetic run log, write READY to result.txt, recover from an overflow, and report READY.`,
        cwd,
        dcpEnabled: false,
        nativeCompactionConfig: { maxTokens: 256, maxOverflowRetries: 1 },
        onSessionEvent: (event) => observedEvents.push(event),
      })

      expect(fetchCount).toBe(5)
      expect(result.execution).toMatchObject({ status: 'completed', requestCount: 5 })
      expect(result.verification).toBe('pending')
      expect(result.ledger.success).toBe(false)
      expect(result.ledger.attempts).toHaveLength(5)
      expect(result.ledger.attempts[0]).toMatchObject({ status: 'success' })
      expect(result.ledger.attempts[1]).toMatchObject({ status: 'success' })
      expect(result.ledger.attempts[2]).toMatchObject({
        status: 'http_error',
        usage: null,
        cost: null,
      })
      expect(result.ledger.attempts[3]).toMatchObject({
        status: 'success',
        metadata: { purpose: 'compaction' },
      })
      expect(result.ledger.attempts[3]?.cost).toBeGreaterThan(0)
      expect(result.ledger.attempts[4]).toMatchObject({
        status: 'success',
        usage: { outputTokens: 30 },
      })
      expect(result.ledger.usageComplete).toBe(false)
      expect(result.ledger.totalCost).toBeNull()
      expect(result.ledger.knownCost).toBeGreaterThan(0)
      expect(requests.map((request) => request.purpose ?? 'conversation')).toEqual([
        'conversation',
        'conversation',
        'conversation',
        'compaction',
        'conversation',
      ])
      expect(assistantText(result.events)).toContain('READY')
      expect(toolResultText(result.events).some((text) => text.length > 20_000)).toBe(true)
      expect(result.events.some((event) => event.type === 'compaction/summary')).toBe(true)
      recordMessagesAgainstSession(requests, runDescriptor.runId)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('reserves unknown overflow spend before admitting an auxiliary summary request', async () => {
    const cwd = await createCwd()
    const runDescriptor = descriptor({
      runId: 'unknown-cost-reservation-run',
      model: 'deepseek-flash',
      provider: 'deepseek',
      startedAt: Date.now(),
    })
    const observedEvents: SessionEvent[] = []
    const requests: RecordedRequest[] = []
    const fetchPurposes: Array<GenerateOptions['purpose']> = []
    let fetchCount = 0
    let conversationCount = 0
    const evidencePreamble = Array.from(
      { length: 60 },
      (_, index) =>
        `Evidence item ${index}: source manifest package-${index} records checksum ${index.toString(16)} and confirms rollback remains available before deployment.`,
    ).join('\n')
    const longTerminalOutput =
      'routine event status ok; verify checksum before rollout\n'.repeat(1000)

    globalThis.fetch = async () => {
      fetchCount++
      const purpose = fetchPurposes.shift()
      if (purpose !== undefined)
        throw new Error(`unknown-cost budget unexpectedly dispatched ${purpose}`)
      conversationCount++
      if (conversationCount === 1)
        return completion(terminalCall('read-history', 'cat run.log'), 'tool_calls')
      if (conversationCount === 2) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'context_length_exceeded',
              type: 'invalid_request_error',
              message: 'The request exceeds the model context window.',
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error('unknown-cost fixture unexpectedly retried after the reservation limit')
    }

    try {
      const result = await runTask({
        descriptor: runDescriptor,
        adapterFactory: (onAttempt) => {
          const adapter = new ModelInfoAdapter({
            baseUrl: 'https://example.invalid/v1',
            apiKey: 'test-only-redacted-key',
            onAttempt,
          })
          const stream = adapter.stream.bind(adapter)
          adapter.stream = async function* (options: GenerateOptions) {
            requests.push({
              messages: structuredClone(options.messages),
              purpose: options.purpose,
              eventsAtDispatch: structuredClone(observedEvents),
            })
            fetchPurposes.push(options.purpose)
            yield* stream(options)
          } as typeof adapter.stream
          return adapter
        },
        maxRequests: 3,
        maxCostUSD: 0.022,
        deadlineMs: 60_000,
        terminal: async (command) => {
          if (command !== 'cat run.log') throw new Error('unexpected terminal command')
          return { stdout: longTerminalOutput, stderr: '', returnCode: 0 }
        },
        instruction: `${evidencePreamble}\nInspect the synthetic run log and recover from a provider overflow.`,
        cwd,
        dcpEnabled: false,
        nativeCompactionConfig: { maxTokens: 256, maxOverflowRetries: 1 },
        onSessionEvent: (event) => observedEvents.push(event),
      })

      expect(fetchCount).toBe(2)
      expect(requests.map((request) => request.purpose ?? 'conversation')).toEqual([
        'conversation',
        'conversation',
      ])
      expect(result.execution).toMatchObject({
        status: 'budget_exceeded',
        reason: 'cost_reservation',
        requestCount: 2,
      })
      expect(result.ledger.attempts).toHaveLength(2)
      expect(result.ledger.attempts[0]).toMatchObject({ status: 'success' })
      expect(result.ledger.attempts[1]).toMatchObject({
        status: 'http_error',
        usage: null,
        cost: null,
      })
      expect(result.ledger.totalCost).toBeNull()
      expect(result.ledger.usageComplete).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('records native pressure summaries as billed compaction attempts in both paired arms', async () => {
    const longToolOutput = 'routine event status ok; verify checksum before rollout\n'.repeat(
      1000,
    )
    const evidencePreamble = Array.from(
      { length: 60 },
      (_, index) =>
        `Evidence item ${index}: source manifest package-${index} records checksum ${index.toString(16)} and confirms rollback remains available before deployment.`,
    ).join('\n')
    const nativeCompactionConfig = {
      thresholdRatio: 0.002,
      headroomTokens: 0,
      retainTokens: 1,
      maxTokens: 256,
    }

    async function runPressureArm(arm: 'baseline' | 'candidate', dcpEnabled: boolean) {
      const cwd = await createCwd()
      const runDescriptor = descriptor({
        runId: `pressure-${arm}`,
        taskId: 'pressure-task',
        arm,
        replicate: 1,
        model: 'deepseek-flash',
        provider: 'deepseek',
        startedAt: Date.now(),
      })
      const observedEvents: SessionEvent[] = []
      const requests: RecordedRequest[] = []
      const fetchPurposes: Array<GenerateOptions['purpose']> = []
      let fetchCount = 0
      let conversationCount = 0

      globalThis.fetch = async () => {
        fetchCount++
        const purpose = fetchPurposes.shift()
        if (purpose === 'compaction') {
          return completion(
            {
              content:
                'Checkpoint: routine diagnostics are preserved; inspect exact files before rollout.',
            },
            'stop',
            {
              prompt_tokens: 20_000,
              prompt_cache_hit_tokens: 0,
              completion_tokens: 256,
            },
          )
        }
        if (purpose !== undefined && purpose !== 'session-title') {
          throw new Error(`unexpected LLM purpose ${purpose}`)
        }
        conversationCount++
        if (conversationCount === 1) {
          return completion(
            terminalCall('write-ready', 'printf READY > result.txt'),
            'tool_calls',
          )
        }
        if (conversationCount === 2) {
          return completion(terminalCall('read-log', 'cat run.log'), 'tool_calls')
        }
        if (conversationCount === 3) {
          return completion({ content: 'READY' }, 'stop', {
            prompt_tokens: 8_000,
            prompt_cache_hit_tokens: 0,
            completion_tokens: 30,
          })
        }
        throw new Error('unexpected extra conversation request in pressure fixture')
      }

      try {
        const result = await runTask({
          descriptor: runDescriptor,
          adapterFactory: (onAttempt) => {
            const adapter = new ModelInfoAdapter({
              baseUrl: 'https://example.invalid/v1',
              apiKey: 'test-only-redacted-key',
              onAttempt,
            })
            const stream = adapter.stream.bind(adapter)
            adapter.stream = async function* (options: GenerateOptions) {
              requests.push({
                messages: structuredClone(options.messages),
                purpose: options.purpose,
                eventsAtDispatch: structuredClone(observedEvents),
              })
              fetchPurposes.push(options.purpose)
              yield* stream(options)
            } as typeof adapter.stream
            return adapter
          },
          maxRequests: 6,
          maxCostUSD: 10,
          deadlineMs: 60_000,
          terminal: async (command) => {
            if (command === 'printf READY > result.txt') {
              return { stdout: 'READY', stderr: '', returnCode: 0 }
            }
            if (command === 'cat run.log') {
              return { stdout: longToolOutput, stderr: '', returnCode: 0 }
            }
            throw new Error('unexpected terminal command')
          },
          instruction: `${evidencePreamble}\nInspect run.log with terminal, write READY to result.txt, and report READY after checking the evidence.`,
          cwd,
          dcpEnabled,
          nativeCompactionConfig,
          onSessionEvent: (event) => observedEvents.push(event),
        })
        return { result, requests, fetchCount }
      } finally {
        await rm(cwd, { recursive: true, force: true })
      }
    }

    const baseline = await runPressureArm('baseline', false)
    const candidate = await runPressureArm('candidate', true)

    for (const { result, requests, fetchCount } of [baseline, candidate]) {
      expect(fetchCount).toBeGreaterThan(3)
      expect(result.execution).toMatchObject({ status: 'completed', requestCount: fetchCount })
      expect(result.ledger.attempts).toHaveLength(fetchCount)
      expect(result.ledger.usageComplete).toBe(true)
      expect(result.ledger.success).toBe(false)
      expect(assistantText(result.events)).toContain('READY')
      const largeOutput = result.events.find(
        (event) =>
          event.type === 'tool/result' &&
          toolResultText([event]).some((text) => text.length > 20_000),
      )
      expect(largeOutput).toBeDefined()
      if (!largeOutput)
        throw new Error('large terminal output was not retained in the event log')
      const compactionEventTypes = result.events
        .filter((event) => event.type.startsWith('compaction/'))
        .map((event) => event.type)
      expect(compactionEventTypes).toEqual(
        expect.arrayContaining(['compaction/start', 'compaction/summary', 'compaction/end']),
      )
      expect(
        result.events.some(
          (event) => event.type === 'compaction/start' && event.seq > largeOutput.seq,
        ),
      ).toBe(true)

      const compactionAttempts = result.ledger.attempts.filter(
        (attempt) => attempt.metadata.purpose === 'compaction',
      )
      expect(compactionAttempts.length).toBeGreaterThan(0)
      expect(requests.filter((request) => request.purpose === 'compaction')).toHaveLength(
        compactionAttempts.length,
      )
      for (const attempt of compactionAttempts) {
        expect(attempt.status).toBe('success')
        expect(attempt.usage).not.toBeNull()
        expect(attempt.cost).toBeGreaterThan(0)
      }
      expect(compactionAttempts.some((attempt) => attempt.usage?.outputTokens === 256)).toBe(
        true,
      )
      const summedAttemptCosts = result.ledger.attempts.reduce(
        (sum, attempt) => sum + (attempt.cost ?? 0),
        0,
      )
      const conversationCosts = result.ledger.attempts
        .filter((attempt) => attempt.metadata.purpose !== 'compaction')
        .reduce((sum, attempt) => sum + (attempt.cost ?? 0), 0)
      expect(result.ledger.totalCost).toBeCloseTo(summedAttemptCosts, 12)
      expect(result.ledger.totalCost).toBeGreaterThan(conversationCosts)
      recordMessagesAgainstSession(requests, result.ledger.runId)
    }

    expect(baseline.result.ledger).toMatchObject({ arm: 'baseline', taskId: 'pressure-task' })
    expect(candidate.result.ledger).toMatchObject({ arm: 'candidate', taskId: 'pressure-task' })
    expect(baseline.result.ledger.provider).toBe(candidate.result.ledger.provider)
    expect(baseline.result.ledger.model).toBe(candidate.result.ledger.model)
  })
})
