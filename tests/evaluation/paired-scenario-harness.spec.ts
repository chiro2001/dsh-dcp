import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { GenerateOptions, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { buildBoundaryMarker } from '../../src/refs/marker.js'
import { resolveConfig } from '../../src/config.js'
import { runTask } from '../../scripts/evaluation/harness.js'
import type { RunRecord } from '../../scripts/evaluation/ledger.js'
import { OpenCodeGoAdapter } from '../e2e-real/opencode-go-adapter.js'
import {
  buildScenarioPrefix,
  createScenarioFiles,
} from '../../scripts/evaluation/single-scenario.js'
import { descriptor } from './helpers.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const compressionConfig = resolveConfig({
  compress: { retainRecentTurns: 2, minNetSavingsTokens: 1 },
  manualMode: { default: true, automaticStrategies: false },
})
const scenarioCompressionConfig = resolveConfig({
  compress: { protectUserMessages: true },
  manualMode: { default: true, automaticStrategies: false },
  nudge: { enabled: false },
})

type CapturedRequest = {
  system?: string
  messages: GenerateOptions['messages']
  tools: NonNullable<GenerateOptions['tools']>
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
    JSON.stringify({ choices: [{ message, finish_reason: finishReason }], usage }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function compressCall(endRef = 'm0002', callId = 'compress-old-turn'): Record<string, unknown> {
  return {
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: {
          name: 'compress',
          arguments: JSON.stringify({
            topic: 'completed first turn',
            content: [
              {
                startRef: 'm0001',
                endRef,
                summary: 'The first turn established a concise preserved checkpoint.',
              },
            ],
          }),
        },
      },
    ],
  }
}

function createThreeTurnSeed(): readonly SessionEvent[] {
  const session = Session.create(SessionId('paired-scenario-seed'))
  for (const turn of [1, 2, 3]) {
    session.append('turn/start', { turn })
    session.append(
      'user/message',
      createUserMessage({
        content: [
          {
            type: 'text',
            text: buildBoundaryMarker(`m${String(turn).padStart(4, '0')}`, turn, 1),
          },
        ],
        source: { kind: 'dsh-dcp' },
      }),
      { surfaceOp: 'append' },
    )
    const text =
      turn === 1
        ? `old-turn-only-needle\n${'Earlier public investigation details; verify exact cents before settling.\n'.repeat(120)}`
        : `retained-turn-${turn}-needle\n${'Recent public evidence remains relevant to the open task.\n'.repeat(8)}`
    session.append(
      'user/message',
      createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
      { surfaceOp: 'append' },
    )
    session.append('step/start', { turn, step: 1 })
    session.append(
      'assistant/message',
      {
        turn,
        step: 1,
        stream: [],
        message: createAssistantMessage({
          content: [{ type: 'text', text: `synthetic assistant response for turn ${turn}` }],
          source: { provider: 'synthetic-fixture', model: 'paired-scenario' },
        }),
      },
      { surfaceOp: 'append' },
    )
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return structuredClone([...session.snapshotEvents()])
}

async function runArm(
  compressionPermission: 'active' | 'inactive',
  seed: readonly SessionEvent[],
) {
  const runId = `paired-${compressionPermission}`
  const requests: CapturedRequest[] = []
  const requestPurposes: Array<GenerateOptions['purpose']> = []
  const ledgers: RunRecord[] = []
  let context: Context | undefined
  let fetchCount = 0
  let conversationResponses = 0

  globalThis.fetch = async () => {
    if (requestPurposes.length === 0)
      throw new Error('HTTP request was not attached to a model attempt')
    requestPurposes.shift()
    fetchCount++
    conversationResponses++
    if (conversationResponses === 1) return completion(compressCall(), 'tool_calls')
    if (conversationResponses === 2)
      return completion({ content: 'The permitted compression attempt is complete.' }, 'stop')
    throw new Error('paired harness unexpectedly dispatched another conversation request')
  }

  const result = await runTask({
    descriptor: descriptor({
      runId,
      taskId: 'single-scenario',
      arm: compressionPermission,
      model: 'deepseek-flash',
      provider: 'deepseek',
      startedAt: Date.now(),
    }),
    instruction:
      'Synthetic paired replay: compress the completed first turn, then report done.',
    cwd: process.cwd(),
    dcpEnabled: true,
    dcpConfig: compressionConfig,
    compressionPermission,
    seed,
    maxRequests: 3,
    deadlineMs: 30_000,
    terminal: async () => ({ stdout: '', stderr: '', returnCode: 0 }),
    onContext: (value) => {
      context = value
    },
    onLedger: (record) => ledgers.push(structuredClone(record)),
    adapterFactory: (onAttempt) => {
      const adapter = new ModelInfoAdapter({
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-only-redacted-key',
        onAttempt,
      })
      const stream = adapter.stream.bind(adapter)
      adapter.stream = async function* (options: GenerateOptions) {
        const agent = context?.agents.get(SessionId(runId))
        if (!agent) throw new Error('seeded Agent was not published before request dispatch')
        requests.push({
          system: options.system,
          messages: structuredClone(options.messages),
          tools: structuredClone(options.tools ?? []),
          purpose: options.purpose,
          eventsAtDispatch: structuredClone([...agent.session.snapshotEvents()]),
        })
        requestPurposes.push(options.purpose)
        yield* stream(options)
      } as typeof adapter.stream
      return adapter
    },
  })

  return { result, requests, ledgers, fetchCount }
}

async function runScenarioStage(options: {
  runId: string
  seed: readonly SessionEvent[]
  instruction: string
  compressionPermission: 'active' | 'inactive'
  responses: Response[]
  dcpConfig?: ReturnType<typeof resolveConfig>
}) {
  const requests: CapturedRequest[] = []
  const purposes: Array<GenerateOptions['purpose']> = []
  const responses = [...options.responses]
  const maxRequests = responses.length
  let context: Context | undefined
  let fetchCount = 0

  globalThis.fetch = async () => {
    if (purposes.length === 0) throw new Error('fetch escaped the scripted model adapter')
    purposes.shift()
    fetchCount++
    const response = responses.shift()
    if (response === undefined) throw new Error('scenario exhausted its mocked responses')
    return response
  }

  const result = await runTask({
    descriptor: descriptor({
      runId: options.runId,
      taskId: 'single-scenario',
      arm: options.compressionPermission,
      model: 'deepseek-flash',
      provider: 'deepseek',
      startedAt: Date.now(),
    }),
    instruction: options.instruction,
    cwd: process.cwd(),
    dcpEnabled: true,
    dcpConfig: options.dcpConfig ?? scenarioCompressionConfig,
    compressionPermission: options.compressionPermission,
    seed: options.seed,
    maxRequests,
    deadlineMs: 30_000,
    terminal: async () => ({ stdout: '', stderr: '', returnCode: 0 }),
    onContext: (value) => {
      context = value
    },
    adapterFactory: (onAttempt) => {
      const adapter = new ModelInfoAdapter({
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'test-only-redacted-key',
        onAttempt,
      })
      const stream = adapter.stream.bind(adapter)
      adapter.stream = async function* (request: GenerateOptions) {
        const agent = context?.agents.get(SessionId(options.runId))
        if (!agent) throw new Error('scenario Agent missing at model dispatch')
        requests.push({
          system: request.system,
          messages: structuredClone(request.messages),
          tools: structuredClone(request.tools ?? []),
          purpose: request.purpose,
          eventsAtDispatch: structuredClone([...agent.session.snapshotEvents()]),
        })
        purposes.push(request.purpose)
        yield* stream(request)
      } as typeof adapter.stream
      return adapter
    },
  })

  return { result, requests, fetchCount, unusedResponses: responses.length }
}

function sessionDerivedAtDispatch(request: CapturedRequest, sessionId: string) {
  return Session.create(SessionId(sessionId), request.eventsAtDispatch).deriveMessages()
}

describe('paired evaluation harness with a seeded public prefix', () => {
  it('holds request projection fixed while the compression permission changes outcomes', async () => {
    const seed = createThreeTurnSeed()
    const seedSnapshot = structuredClone(seed)
    const inactive = await runArm('inactive', seed)
    const active = await runArm('active', seed)

    expect(seed).toEqual(seedSnapshot)
    expect(inactive.result.execution).toMatchObject({ status: 'completed', requestCount: 2 })
    expect(active.result.execution).toMatchObject({ status: 'completed', requestCount: 2 })

    const inactiveInitial = inactive.requests.find(
      (request) => request.purpose !== 'compaction',
    )
    const activeInitial = active.requests.find((request) => request.purpose !== 'compaction')
    expect(inactiveInitial).toBeDefined()
    expect(activeInitial).toBeDefined()
    expect(activeInitial?.system).toEqual(inactiveInitial?.system)
    expect(
      activeInitial?.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content),
    ).toEqual(
      inactiveInitial?.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content),
    )
    expect(activeInitial?.tools).toEqual(inactiveInitial?.tools)
    expect(activeInitial?.tools.some((tool) => tool.name === 'compress')).toBe(true)
    expect(inactiveInitial?.tools.some((tool) => tool.name === 'compress')).toBe(true)

    const seedMessages = Session.create(SessionId('paired-visible-seed'), seed).deriveMessages()
    for (const [sessionId, request] of [
      ['paired-inactive', inactiveInitial],
      ['paired-active', activeInitial],
    ] as const) {
      expect(request).toBeDefined()
      if (!request) throw new Error('initial model request missing')
      expect(JSON.stringify(request.messages)).toBe(
        JSON.stringify(sessionDerivedAtDispatch(request, sessionId)),
      )
      expect(
        request.messages
          .filter((message) => message.role !== 'system')
          .slice(0, seedMessages.length),
      ).toEqual(seedMessages)
    }
    const inactiveResults = inactive.result.events.filter(
      (event) => event.type === 'tool/result',
    )
    const denied = inactiveResults.find(
      (event) =>
        event.type === 'tool/result' &&
        event.data.message.source.callId === 'compress-old-turn',
    )
    expect(denied?.type).toBe('tool/result')
    if (denied?.type !== 'tool/result') throw new Error('inactive compress result missing')
    expect(denied.data.message.isError).toBe(true)
    expect(inactive.result.events.some((event) => event.type === 'compaction/summary')).toBe(
      false,
    )
    expect(
      inactive.result.events.some(
        (event) => event.type === 'user/message' && typeof event.surfaceOp === 'object',
      ),
    ).toBe(false)

    expect(active.result.events.some((event) => event.type === 'compaction/summary')).toBe(true)
    expect(
      active.result.events.some(
        (event) => event.type === 'user/message' && typeof event.surfaceOp === 'object',
      ),
    ).toBe(true)
    const activeSession = Session.create(
      SessionId('paired-active-result'),
      active.result.events,
    )
    const activeText = activeSession
      .deriveMessages()
      .flatMap((message) =>
        message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])),
      )
      .join('\n')
    expect(activeText).not.toContain('old-turn-only-needle')
    expect(activeText).toContain('retained-turn-2-needle')
    expect(activeText).toContain('retained-turn-3-needle')

    for (const arm of [inactive, active]) {
      expect(arm.fetchCount).toBe(arm.result.ledger.attempts.length)
      expect(arm.result.execution.requestCount).toBe(arm.result.ledger.attempts.length)
      expect(arm.fetchCount).toBeLessThanOrEqual(3)
    }
    expect(inactive.fetchCount).toBe(2)
    expect(
      inactive.result.ledger.attempts.some(
        (attempt) => attempt.metadata.purpose === 'compaction',
      ),
    ).toBe(false)
    expect(active.fetchCount).toBe(2)
    expect(
      active.result.ledger.attempts.filter(
        (attempt) => attempt.metadata.purpose === 'compaction',
      ),
    ).toHaveLength(0)
  })

  it('forks both arms from one closed READY preparation with m0004 before turn-five compression', async () => {
    const prefix = buildScenarioPrefix(createScenarioFiles({ eventCount: 16 }))
    const prefixSession = Session.create(SessionId('cli-shaped-prefix'), prefix)
    expect(
      prefixSession
        .snapshotEvents()
        .filter((event) => event.type === 'turn/end')
        .map((event) => (event.type === 'turn/end' ? event.data.turn : -1)),
    ).toEqual([1, 2, 3])

    const preparationInstruction =
      'Preparation only: consume this explicitly constructed investigation history. Do not call tools, compress, or change files. Reply exactly READY. Code repair remains open for the next turn.'
    const prepared = await runScenarioStage({
      runId: 'cli-shaped-common-prepare',
      seed: prefix,
      instruction: preparationInstruction,
      compressionPermission: 'inactive',
      dcpConfig: scenarioCompressionConfig,
      responses: [completion({ content: 'READY' }, 'stop')],
    })
    expect(prepared.result.execution).toMatchObject({ status: 'completed', requestCount: 1 })
    expect(prepared.fetchCount).toBe(1)
    expect(prepared.unusedResponses).toBe(0)
    expect(prepared.result.events.some((event) => event.type === 'compaction/summary')).toBe(
      false,
    )

    const preparedEvents = prepared.result.events
    const preparedSnapshot = structuredClone(preparedEvents)
    const m4 = preparedEvents.find(
      (event) =>
        event.type === 'user/message' &&
        event.data.source.kind === 'dsh-dcp' &&
        event.data.content.some(
          (block) =>
            block.type === 'text' && block.text.trim() === buildBoundaryMarker('m0004', 4, 1),
        ),
    )
    expect(m4?.type).toBe('user/message')
    expect(m4).toBeDefined()
    const preparationUser = preparedEvents.find(
      (event) =>
        event.type === 'user/message' &&
        event.data.content.some(
          (block) => block.type === 'text' && block.text.includes(preparationInstruction),
        ),
    )
    expect(preparationUser?.type).toBe('user/message')
    expect(Number(m4?.seq)).toBeLessThan(Number(preparationUser?.seq))
    const turnFourSystem = preparedEvents.find(
      (event) => event.type === 'system/message' && event.data.turn === 4,
    )
    expect(turnFourSystem?.type).toBe('system/message')
    expect(Number(turnFourSystem?.seq)).toBeLessThan(Number(m4?.seq))
    const preparedTurnEnds = preparedEvents.filter((event) => event.type === 'turn/end')
    expect(
      preparedTurnEnds.map((event) => (event.type === 'turn/end' ? event.data.turn : -1)),
    ).toEqual([1, 2, 3, 4])
    expect(
      preparedTurnEnds.every(
        (event) => event.type === 'turn/end' && event.data.reason.kind === 'completed',
      ),
    ).toBe(true)
    const preparedAssistant = preparedEvents.findLast(
      (event) => event.type === 'assistant/message',
    )
    expect(
      preparedAssistant?.type === 'assistant/message' &&
        preparedAssistant.data.message.content.some(
          (block) => block.type === 'text' && block.text.trim() === 'READY',
        ),
    ).toBe(true)

    const protectedTask =
      'Protected continuation task marker: KEEP_TURN_FOUR_AND_FIVE. Repair ledger.py and report READY.'
    const inactive = await runScenarioStage({
      runId: 'cli-shaped-inactive',
      seed: preparedEvents,
      instruction: `Compression is inactive for this continuation. Do not call compress.\n${protectedTask}`,
      compressionPermission: 'inactive',
      dcpConfig: scenarioCompressionConfig,
      responses: [completion({ content: 'Turn five complete without compression.' }, 'stop')],
    })
    const active = await runScenarioStage({
      runId: 'cli-shaped-active',
      seed: preparedEvents,
      instruction: `Compression is active. First try compressing the completed investigation range m0001 (inclusive) to m0004 (exclusive). If the tool rejects that range, follow its correction exactly, then compress only the eligible older range. Preserve the task/spec and diagnosis in factual prose. Use native tool_calls. After a committed result, stop compressing.\n${protectedTask}`,
      compressionPermission: 'active',
      dcpConfig: scenarioCompressionConfig,
      responses: [
        completion(compressCall('m0004', 'compress-m4-rejected'), 'tool_calls'),
        completion(compressCall('m0003', 'compress-m3-committed'), 'tool_calls'),
        completion({ content: 'Turn five complete after the requested checkpoint.' }, 'stop'),
      ],
    })

    expect(preparedEvents).toEqual(preparedSnapshot)
    expect(inactive.result.execution).toMatchObject({ status: 'completed', requestCount: 1 })
    expect(active.result.execution).toMatchObject({ status: 'completed', requestCount: 3 })
    expect(inactive.fetchCount).toBe(inactive.result.ledger.attempts.length)
    expect(active.fetchCount).toBe(active.result.ledger.attempts.length)

    for (const [runId, arm] of [
      ['cli-shaped-inactive', inactive],
      ['cli-shaped-active', active],
    ] as const) {
      expect(arm.requests[0]?.eventsAtDispatch.slice(0, preparedEvents.length)).toEqual(
        preparedEvents,
      )
      for (const request of arm.requests) {
        expect(JSON.stringify(request.messages)).toBe(
          JSON.stringify(sessionDerivedAtDispatch(request, runId)),
        )
      }
    }

    const compressCalls = active.result.events.filter(
      (event) => event.type === 'tool/call' && event.data.name === 'compress',
    )
    expect(compressCalls).toHaveLength(2)
    const ranges = compressCalls.map((event) => {
      if (event.type !== 'tool/call') throw new Error('compress call missing')
      return {
        callId: String(event.data.callId),
        args: JSON.parse(event.data.arguments) as {
          content: Array<{ startRef: string; endRef: string }>
        },
      }
    })
    expect(ranges.map((range) => range.args.content[0]?.endRef)).toEqual(['m0004', 'm0003'])

    const toolResultText = (callId: string) =>
      active.result.events
        .flatMap((event) =>
          event.type === 'tool/result' && event.data.message.source.callId === callId
            ? event.data.message.content.flatMap((block) =>
                block.type === 'text' ? [block.text] : [],
              )
            : [],
        )
        .join('\n')
    const m4Result = active.result.events.find(
      (event) =>
        event.type === 'tool/result' &&
        event.data.message.source.callId === 'compress-m4-rejected',
    )
    expect(m4Result?.type).toBe('tool/result')
    if (m4Result?.type !== 'tool/result') throw new Error('m4 rejection receipt missing')
    expect(m4Result.data.message.isError).toBe(true)
    expect(toolResultText('compress-m4-rejected')).toContain('RECENT_RANGE')
    const m3Result = active.result.events.find(
      (event) =>
        event.type === 'tool/result' &&
        event.data.message.source.callId === 'compress-m3-committed',
    )
    expect(m3Result?.type).toBe('tool/result')
    if (m3Result?.type !== 'tool/result') throw new Error('m3 commit receipt missing')
    expect(m3Result.data.message.isError).toBe(false)

    const summary = active.result.events.find((event) => event.type === 'compaction/summary')
    expect(summary?.type).toBe('compaction/summary')
    const m3 = prefix.find(
      (event) =>
        event.type === 'user/message' &&
        event.data.source.kind === 'dsh-dcp' &&
        event.data.content.some(
          (block) =>
            block.type === 'text' && block.text.trim() === buildBoundaryMarker('m0003', 3, 1),
        ),
    )
    if (summary?.type !== 'compaction/summary' || m3?.type !== 'user/message')
      throw new Error('eligible m0003 boundary or active summary missing')
    expect(Number(summary.data.shadowedRange.end)).toBeLessThan(Number(m3.seq))
    expect(summary.data.shadowedSeqs).not.toContain(m3.seq)

    const activeTurns = active.result.events.filter((event) => event.type === 'turn/end')
    const inactiveTurns = inactive.result.events.filter((event) => event.type === 'turn/end')
    expect(
      activeTurns.map((event) => (event.type === 'turn/end' ? event.data.turn : -1)),
    ).toEqual([1, 2, 3, 4, 5])
    expect(
      inactiveTurns.map((event) => (event.type === 'turn/end' ? event.data.turn : -1)),
    ).toEqual([1, 2, 3, 4, 5])
    expect(active.result.events.some((event) => event.type === 'compaction/summary')).toBe(true)
    expect(inactive.result.events.some((event) => event.type === 'compaction/summary')).toBe(
      false,
    )

    const activeMessages = Session.create(
      SessionId('cli-shaped-active-result'),
      active.result.events,
    ).deriveMessages()
    const inactiveMessages = Session.create(
      SessionId('cli-shaped-inactive-result'),
      inactive.result.events,
    ).deriveMessages()
    const messageText = (messages: typeof activeMessages) =>
      messages
        .flatMap((message) =>
          message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])),
        )
        .join('\n')
    const activeText = messageText(activeMessages)
    const inactiveText = messageText(inactiveMessages)
    for (const phrase of [
      'Synthetic benchmark replay: event-ledger repair',
      'Open work: repair ledger.py using exact integer cents',
      'Code repair remains open for the next turn.',
      'READY',
      'KEEP_TURN_FOUR_AND_FIVE',
    ]) {
      expect(activeText).toContain(phrase)
      expect(inactiveText).toContain(phrase)
    }
    expect(inactiveText).toContain('Constructed investigation replay complete')
  })

  it.each([
    {
      label: 'DCP disabled',
      dcpEnabled: false,
      config: compressionConfig,
    },
    {
      label: 'manual mode default disabled',
      dcpEnabled: true,
      config: resolveConfig({
        manualMode: { default: false, automaticStrategies: false },
      }),
    },
    {
      label: 'automatic strategies enabled',
      dcpEnabled: true,
      config: resolveConfig({
        manualMode: { default: true, automaticStrategies: true },
      }),
    },
  ])('rejects compression permission when $label', async ({ dcpEnabled, config }) => {
    let fetchCount = 0
    globalThis.fetch = async () => {
      fetchCount++
      return completion({ content: 'must not be requested' }, 'stop')
    }

    await expect(
      runTask({
        descriptor: descriptor({
          runId: `invalid-permission-${dcpEnabled}-${config.manualMode.default}-${config.manualMode.automaticStrategies}`,
          startedAt: Date.now(),
        }),
        instruction: 'invalid compression permission must fail before any request',
        cwd: process.cwd(),
        dcpEnabled,
        dcpConfig: config,
        compressionPermission: 'active',
        seed: createThreeTurnSeed(),
        maxRequests: 1,
        deadlineMs: 30_000,
        terminal: async () => ({ stdout: '', stderr: '', returnCode: 0 }),
        adapterFactory: (onAttempt) =>
          new ModelInfoAdapter({
            baseUrl: 'https://example.invalid/v1',
            apiKey: 'test-only-redacted-key',
            onAttempt,
          }),
      }),
    ).rejects.toThrow()
    expect(fetchCount).toBe(0)
  })
})
