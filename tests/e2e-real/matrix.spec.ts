import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as agentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import * as compactionInvariant from '@deepseek-ai/dsh-compaction/invariant'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { type LlmAdapter } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import * as dcpPlugin from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'
import { decodeDcpMeta, type DcpCheckpointMetaV1 } from '../../src/protocol/metadata.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { readRealModelConfig } from '../../scripts/real-model-config.js'
import { ScriptedAdapter } from '../integration/agentloop-scripted.js'
import { OpenCodeGoAdapter } from './opencode-go-adapter.js'

const RECOVERY_PHRASE = 'CRIMSON-ORBIT-742'
const LEDGER_SALT = 'VIOLET-39'
const REAL_MODEL_REQUESTED = process.env.DSH_DCP_REAL_MODEL === '1'
const REAL_MODEL_CONFIG = REAL_MODEL_REQUESTED ? readRealModelConfig() : undefined
const REAL_MODEL_ENABLED = REAL_MODEL_CONFIG !== undefined

interface MatrixHarness {
  ctx: Context
  requestBudgetViolations: Array<{ agentId: string; turn: number; step: number; limit: number }>
  dispose(): Promise<void>
}

interface CompressEntry {
  startRef: string
  endRef: string
  summary: string
}

interface CompressArguments {
  topic?: string
  content?: CompressEntry[]
}

interface CheckpointRecord {
  meta: DcpCheckpointMetaV1
  text: string
}

function user(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function longHistory(label: string, fact?: string): string {
  const actions = ['kept', 'moved', 'rerouted', 'rolled back']
  const checks = [
    'canary passed',
    'latency stayed below target',
    'replica caught up',
    'rollback verified',
  ]
  const details = Array.from({ length: 32 }, (_, index) => {
    const shard = String(((index * 7) % 23) + 1).padStart(2, '0')
    const version = `v${2 + Math.floor(index / 12)}.${index % 12}`
    return `${label} change ${index + 1}: ${actions[index % actions.length]} shard-${shard} on ${version}; decision ${index % 2 === 0 ? 'preserve ordering' : 'cap retries'} after the migration check; verification ${checks[index % checks.length]}; follow-up ticket OPS-${700 + index} remains open.`
  }).join('\n')
  return [fact, details].filter(Boolean).join('\n')
}

function setupTurn(text: string): string {
  return `${text}\n\nFor this setup turn only, do not call tools or compress. Reply exactly READY.`
}

function messageText(message: { content: readonly { type: string; text?: string }[] }): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

function visibleTextOutsideCheckpoints(
  session: Session,
  excludedBlockRefs: readonly string[],
): string {
  return session
    .deriveMessages()
    .filter((message) => {
      const decoded = decodeDcpMeta(message.source)
      return !(
        decoded.ok &&
        decoded.meta.kind === 'summary' &&
        excludedBlockRefs.includes(decoded.meta.blockRef)
      )
    })
    .map(messageText)
    .join('\n')
}

function resultText(message: { content: readonly { type: string; text?: string }[] }): string {
  return messageText(message)
}

function parseCompressArguments(
  event: Extract<SessionEvent, { type: 'tool/call' }>,
): CompressArguments {
  return JSON.parse(event.data.arguments) as CompressArguments
}

function parseRealCompressArguments(
  event: Extract<SessionEvent, { type: 'tool/call' }>,
  session: Session,
): CompressArguments {
  try {
    return parseCompressArguments(event)
  } catch {
    assertReal(false, 'the model emitted invalid JSON for compress arguments', session)
    throw new Error('unreachable after invalid compress arguments')
  }
}

function compressCalls(session: Session): Array<Extract<SessionEvent, { type: 'tool/call' }>> {
  return session
    .snapshotEvents()
    .filter(
      (event): event is Extract<SessionEvent, { type: 'tool/call' }> =>
        event.type === 'tool/call' && event.data.name === 'compress',
    )
}

function assertNoPrematureCompress(session: Session, setupLabel: string): void {
  assertReal(
    compressCalls(session).length === 0,
    `the model called compress during ${setupLabel} before the explicit compression step`,
    session,
  )
}

function resultForCall(session: Session, callId: string): string {
  const result = session
    .snapshotEvents()
    .findLast(
      (event) =>
        event.type === 'tool/result' && String(event.data.message.source.callId) === callId,
    )
  return result?.type === 'tool/result' ? resultText(result.data.message) : ''
}

function checkpoints(session: Session): CheckpointRecord[] {
  const records: CheckpointRecord[] = []
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'user/message') continue
    const decoded = decodeDcpMeta(event.data.source)
    if (!decoded.ok || decoded.meta.kind !== 'summary') continue
    records.push({ meta: decoded.meta, text: messageText(event.data) })
  }
  return records
}

function assistantTextForTurn(session: Session, turn: number): string {
  return session
    .snapshotEvents()
    .filter((event) => event.type === 'assistant/message' && event.data.turn === turn)
    .map((event) => (event.type === 'assistant/message' ? messageText(event.data.message) : ''))
    .join('\n')
}

function safeRealDiagnostics(session: Session): string {
  const events = session.snapshotEvents()
  const toolCalls = events
    .filter((event) => event.type === 'tool/call')
    .map((event) => ({
      turn: event.data.turn,
      step: event.data.step,
      name: event.data.name,
      argumentsLength: event.data.arguments.length,
      ...(event.data.name === 'compress'
        ? { ranges: compressRangesForDiagnostics(event) }
        : {}),
    }))
  const toolResults = events
    .filter((event) => event.type === 'tool/result')
    .map((event) => {
      const text = resultText(event.data.message)
      return {
        turn: event.data.turn,
        step: event.data.step,
        isError: event.data.message.isError,
        outcome: /status=(success|partial|rejected); committed=([^;]+); rejected=([^;]+)/.exec(
          text,
        )?.[0],
      }
    })
  const compressSummaries = events
    .filter(
      (event): event is Extract<SessionEvent, { type: 'tool/call' }> =>
        event.type === 'tool/call' && event.data.name === 'compress',
    )
    .map((event) => ({
      turn: event.data.turn,
      step: event.data.step,
      entries: compressEntriesForDiagnostics(event),
    }))
  const assistantSteps = events
    .filter((event) => event.type === 'assistant/message')
    .map((event) => ({
      turn: event.data.turn,
      step: event.data.step,
      blocks: event.data.message.content.map((block) =>
        block.type === 'tool-call'
          ? { type: block.type, name: block.name, argumentLength: block.arguments.length }
          : block.type === 'text'
            ? { type: block.type, text: block.text }
            : {
                type: block.type,
                textLength:
                  'text' in block && typeof block.text === 'string'
                    ? block.text.length
                    : undefined,
              },
      ),
    }))
  const failedTurns = events
    .filter((event) => event.type === 'turn/end' && event.data.reason.kind === 'error')
    .map((event) =>
      event.type === 'turn/end' && event.data.reason.kind === 'error'
        ? {
            turn: event.data.turn,
            code: event.data.reason.error.code,
            message: event.data.reason.error.message,
          }
        : undefined,
    )
  const compressTool = realHarness?.ctx.tools.get('compress')
  const snapshot = {
    provider: REAL_MODEL_CONFIG?.provider,
    configuredModel: REAL_MODEL_CONFIG?.model,
    compressSchema: compressTool
      ? {
          name: compressTool.name,
          description: compressTool.description,
          parameters: compressTool.parameters,
        }
      : undefined,
    requests: realAdapter?.requestDiagnostics ?? [],
    responses: realAdapter?.responseDiagnostics ?? [],
    toolCalls,
    toolResults,
    compressSummaries,
    checkpoints: checkpoints(session).map(({ meta, text }) => ({
      blockRef: meta.blockRef,
      consumedBlockRefs: meta.consumedBlockRefs,
      text,
    })),
    assistantSteps,
    failedTurns,
  }
  return JSON.stringify(snapshot, null, 2).replaceAll(
    REAL_MODEL_CONFIG?.apiKey ?? '\u0000',
    '<redacted>',
  )
}

function compressRangesForDiagnostics(
  event: Extract<SessionEvent, { type: 'tool/call' }>,
): Array<{ startRef: string; endRef: string }> | 'invalid-json' | undefined {
  try {
    return parseCompressArguments(event).content?.map(({ startRef, endRef }) => ({
      startRef,
      endRef,
    }))
  } catch {
    return 'invalid-json'
  }
}

function compressEntriesForDiagnostics(
  event: Extract<SessionEvent, { type: 'tool/call' }>,
): CompressEntry[] | 'invalid-json' | undefined {
  try {
    return parseCompressArguments(event).content
  } catch {
    return 'invalid-json'
  }
}

function assertReal(condition: unknown, message: string, session: Session): asserts condition {
  if (!condition) {
    throw new Error(`${message}\nSafe real-model diagnostics:\n${safeRealDiagnostics(session)}`)
  }
}

function emitRealModelMetrics(
  scenario: string,
  requestOffset: number,
  responseOffset: number,
  outcomes: Record<string, boolean>,
): void {
  const requests = realAdapter?.requestDiagnostics.slice(requestOffset) ?? []
  const responses = realAdapter?.responseDiagnostics.slice(responseOffset) ?? []
  const sumUsage = (
    key: 'inputTokens' | 'cacheReadTokens' | 'outputTokens' | 'reasoningTokens',
  ) => responses.reduce((sum, response) => sum + (response.usage?.[key] ?? 0), 0)
  const uncachedInputTokens = sumUsage('inputTokens')
  const cacheReadTokens = sumUsage('cacheReadTokens')
  console.log(
    `REAL_MODEL_METRICS ${JSON.stringify({
      model: REAL_MODEL_CONFIG?.model,
      provider: REAL_MODEL_CONFIG?.provider,
      scenario,
      requestCount: requests.length,
      uncachedInputTokens,
      cacheReadTokens,
      promptTokens: uncachedInputTokens + cacheReadTokens,
      outputTokens: sumUsage('outputTokens'),
      reasoningTokens: sumUsage('reasoningTokens'),
      ...outcomes,
    })}`,
  )
}

function logRealModelTarget(scenario: string): void {
  if (!REAL_MODEL_CONFIG) throw new Error('real-model configuration was not loaded')
  console.log(
    `REAL_MODEL_TARGET ${JSON.stringify({
      scenario,
      host: new URL(REAL_MODEL_CONFIG.baseUrl).host,
      model: REAL_MODEL_CONFIG.model,
      provider: REAL_MODEL_CONFIG.provider,
      hasApiKey: Boolean(REAL_MODEL_CONFIG.apiKey),
    })}`,
  )
}

async function mountHarness(
  adapter: LlmAdapter,
  provider: string,
  model: string,
  config: unknown,
  maxRequestsPerTurn?: number,
): Promise<MatrixHarness> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: {
      personaPrefix:
        'You are a DeepSeek Harness agent. Follow the DCP compression rules and preserve exact facts and identifiers.',
    },
  })
  await ctx.plugin(sessionInvariant as unknown as Plugin)
  await ctx.plugin(agentLoopInvariant as unknown as Plugin)
  await ctx.plugin(compactionInvariant as unknown as Plugin)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter([provider], adapter)
  const requestBudgetViolations: MatrixHarness['requestBudgetViolations'] = []
  if (maxRequestsPerTurn !== undefined) {
    const requestsByAgentTurn = new Map<string, number>()
    ctx.on('agent/pre-step', async ({ agent, turn, step }, next) => {
      const key = `${agent.id}:${turn}`
      const requestCount = (requestsByAgentTurn.get(key) ?? 0) + 1
      requestsByAgentTurn.set(key, requestCount)
      if (requestCount > maxRequestsPerTurn) {
        requestBudgetViolations.push({
          agentId: agent.id,
          turn,
          step,
          limit: maxRequestsPerTurn,
        })
        return { kind: 'reject' }
      }
      return next()
    })
  }
  await ctx.plugin(dcpPlugin as unknown as Plugin, resolveConfig(config))
  return { ctx, requestBudgetViolations, dispose: async () => ctx.fiber.dispose() }
}

function waitForIdle(ctx: Context, agent: { id: string }): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on(
      'agent/status',
      (payload: { agent: { id: string }; status: string }) => {
        if (payload.agent.id === agent.id && payload.status === 'idle') {
          dispose()
          resolve()
        }
      },
    )
  })
}

async function followup(
  harness: MatrixHarness,
  agent: { followup(message: ReturnType<typeof user>): void; id: string; session: Session },
  text: string,
): Promise<void> {
  const responseOffset = realAdapter?.responseDiagnostics.length ?? 0
  agent.followup(user(text))
  await waitForIdle(harness.ctx, agent)
  const responses = realAdapter?.responseDiagnostics.slice(responseOffset) ?? []
  const response = responses.at(-1)
  if (response !== undefined && (response.httpStatus < 200 || response.httpStatus >= 300)) {
    throw new Error(
      `real provider transport failed with HTTP ${response.httpStatus}; not classifying the response as a model decision\nSafe real-model diagnostics:\n${safeRealDiagnostics(agent.session)}`,
    )
  }
  const lastTurnEnd = agent.session
    .snapshotEvents()
    .findLast((event) => event.type === 'turn/end')
  const lengthResponse = responses.find((item) => item.finishReason === 'length')
  if (
    (lastTurnEnd?.type === 'turn/end' && lastTurnEnd.data.reason.kind === 'max-tokens') ||
    lengthResponse !== undefined
  ) {
    throw new Error(
      `model output was truncated at the output-token limit (finishReason=${lengthResponse?.finishReason ?? 'max-tokens'}); no content-quality conclusion is valid\nSafe real-model diagnostics:\n${safeRealDiagnostics(agent.session)}`,
    )
  }
  const lastEvent = agent.session
    .snapshotEvents()
    .findLast((event) => event.type === 'turn/end')
  if (lastEvent?.type === 'turn/end' && lastEvent.data.reason.kind === 'error') {
    throw new Error(
      `AgentLoop turn failed before a stable model response; not classifying it as model behavior\nSafe real-model diagnostics:\n${safeRealDiagnostics(agent.session)}`,
    )
  }
  const violation = harness.requestBudgetViolations.find((item) => item.agentId === agent.id)
  if (violation !== undefined) {
    throw new Error(
      `real-model request budget exceeded: ${violation.limit} pre-steps in turn ${violation.turn} (step ${violation.step})\nSafe real-model diagnostics:\n${safeRealDiagnostics(agent.session)}`,
    )
  }
}

async function hasCredentialFile(root: string, credential: string): Promise<boolean> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) {
        return hasCredentialFile(path, credential)
      }
      if (entry.isFile()) {
        const contents = await readFile(path).catch(() => Buffer.alloc(0))
        return contents.includes(Buffer.from(credential))
      }
      return false
    }),
  )
  return nested.some(Boolean)
}

describe('scripted matrix scaffold (mock adapter)', () => {
  let harness: MatrixHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('mock partial/nested: retries only the failed range and preserves b1 facts', async () => {
    const firstArgs = JSON.stringify({
      topic: 'early phases',
      content: [
        {
          startRef: 'm0001',
          endRef: 'm0002',
          summary: `The recovery phrase is ${RECOVERY_PHRASE}.`,
        },
        { startRef: 'm0002', endRef: 'm0003', summary: `The ledger salt is ${LEDGER_SALT}.` },
      ],
    })
    const retryArgs = JSON.stringify({
      topic: 'early phases',
      content: [
        { startRef: 'm0002', endRef: 'm0003', summary: `The ledger salt is ${LEDGER_SALT}.` },
      ],
    })
    const nestedArgs = JSON.stringify({
      topic: 'preserved project facts',
      content: [
        {
          startRef: 'b1',
          endRef: 'm0005',
          summary:
            'The nested checkpoint preserves all carried-forward identifiers and decisions.',
        },
      ],
    })
    const adapter = new ScriptedAdapter([
      { text: 'Noted.' },
      { text: 'Understood.' },
      { text: 'Ready.' },
      { toolCalls: [{ id: 'matrix-first-compress', name: 'compress', arguments: firstArgs }] },
      { toolCalls: [{ id: 'matrix-retry-compress', name: 'compress', arguments: retryArgs }] },
      { text: 'The failed range is now compressed.' },
      {
        toolCalls: [{ id: 'matrix-nested-compress', name: 'compress', arguments: nestedArgs }],
      },
      { text: 'The nested checkpoint is ready.' },
      { text: `The recovery phrase is ${RECOVERY_PHRASE}; the ledger salt is ${LEDGER_SALT}.` },
    ])
    harness = await mountHarness(adapter, 'scripted', 'scripted-model', {
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    })
    const agent = await harness.ctx.agentLoop.create(SessionId('matrix-scripted'), {
      provider: 'scripted',
      model: 'scripted-model',
    })

    await followup(harness, agent, longHistory('phase alpha', RECOVERY_PHRASE))
    await followup(harness, agent, longHistory('phase beta', LEDGER_SALT))
    await followup(harness, agent, longHistory('phase gamma'))

    const originalAppend = agent.session.append.bind(agent.session)
    let compactionStartAttempts = 0
    let injectedTimeout = false
    const appendSpy = vi
      .spyOn(agent.session, 'append')
      .mockImplementation((type, data, ...opts) => {
        if (type === 'compaction/start') {
          compactionStartAttempts++
          if (compactionStartAttempts === 2 && !injectedTimeout) {
            injectedTimeout = true
            throw new Error('timeout starting the second matrix commit')
          }
        }
        return Reflect.apply(originalAppend, agent.session, [
          type,
          data,
          ...opts,
        ]) as ReturnType<typeof originalAppend>
      })
    try {
      await followup(
        harness,
        agent,
        'Compress ranges m0001..m0002 and m0002..m0003. Preserve every exact identifier and factual detail from each range.',
      )
    } finally {
      appendSpy.mockRestore()
    }

    const initialCalls = compressCalls(agent.session)
    expect(initialCalls).toHaveLength(2)
    expect(parseCompressArguments(initialCalls[0]!).content).toHaveLength(2)
    expect(parseCompressArguments(initialCalls[1]!).content).toEqual([
      {
        startRef: 'm0002',
        endRef: 'm0003',
        summary: `The ledger salt is ${LEDGER_SALT}.`,
      },
    ])
    expect(injectedTimeout).toBe(true)
    expect(compactionStartAttempts).toBeGreaterThanOrEqual(2)
    expect(resultForCall(agent.session, 'matrix-first-compress')).toMatch(
      /status=partial; committed=b1; rejected=m0002\.\.m0003\[TIMEOUT\]/,
    )
    expect(resultForCall(agent.session, 'matrix-retry-compress')).toContain('status=success')

    await followup(harness, agent, longHistory('phase delta'))
    await followup(
      harness,
      agent,
      'Compress the active checkpoint b1 and eligible history before the current boundary. Carry prior checkpoint facts forward verbatim.',
    )
    const nestedCall = compressCalls(agent.session)[2]
    expect(nestedCall).toBeDefined()
    if (!nestedCall) throw new Error('nested compress call missing')
    expect(parseCompressArguments(nestedCall).content).toEqual([
      {
        startRef: 'b1',
        endRef: 'm0005',
        summary:
          'The nested checkpoint preserves all carried-forward identifiers and decisions.',
      },
    ])

    const records = checkpoints(agent.session)
    const block1 = records.find((record) => record.meta.blockRef === 'b1')
    const block3 = records.find((record) => record.meta.blockRef === 'b3')
    expect(block1?.text).toContain(RECOVERY_PHRASE)
    expect(block3?.meta.consumedBlockRefs).toContain('b1')
    expect(block3?.meta.consumedBlockRefs).toContain('b2')
    expect(block3?.text).toContain(block1?.text ?? 'missing b1 checkpoint')
    const state = reduceDcpState(agent.session.snapshotEvents())
    expect(state.blocks.find((block) => block.ref === 'b1')?.membership).toBe('consumed')
    expect(state.blocks.find((block) => block.ref === 'b3')?.membership).toBe('active')

    const recallPrompt =
      'What were the exact recovery phrase and ledger salt from the earlier notes?'
    expect(recallPrompt).not.toContain(RECOVERY_PHRASE)
    expect(recallPrompt).not.toContain(LEDGER_SALT)
    const visibleBeforeRecall = agent.session.deriveMessages()
    const visibleUserText = visibleBeforeRecall
      .filter((message) => message.source.kind === 'user')
      .map(messageText)
      .join('\n')
    expect(visibleUserText).not.toContain(RECOVERY_PHRASE)
    expect(JSON.stringify(visibleBeforeRecall)).toContain(RECOVERY_PHRASE)
    await followup(harness, agent, recallPrompt)
    const finalAnswer = assistantTextForTurn(agent.session, 6)
    expect(finalAnswer).toContain(RECOVERY_PHRASE)
    expect(finalAnswer).toContain(LEDGER_SALT)
  })
})

let realHarness: MatrixHarness | undefined
let realAdapter: OpenCodeGoAdapter | undefined
let isolatedHome: string | undefined
const savedDshHome = process.env.DSH_HOME
const savedXdgDataHome = process.env.XDG_DATA_HOME
const savedXdgConfigHome = process.env.XDG_CONFIG_HOME

async function restoreRealEnvironment(): Promise<boolean> {
  await realHarness?.dispose()
  realHarness = undefined
  realAdapter = undefined
  const credentialPersisted =
    isolatedHome !== undefined && REAL_MODEL_CONFIG !== undefined
      ? await hasCredentialFile(isolatedHome, REAL_MODEL_CONFIG.apiKey)
      : false
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome
  if (savedXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = savedXdgDataHome
  if (savedXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdgConfigHome
  if (isolatedHome !== undefined) {
    await rm(isolatedHome, { recursive: true, force: true })
    isolatedHome = undefined
  }
  return credentialPersisted
}

describe.skipIf(!REAL_MODEL_ENABLED)('real provider quality matrix', () => {
  beforeAll(async () => {
    if (!REAL_MODEL_CONFIG) throw new Error('real-model configuration was not loaded')
    isolatedHome = await mkdtemp(join(tmpdir(), 'dsh-dcp-real-matrix-'))
    process.env.DSH_HOME = join(isolatedHome, 'dsh-home')
    process.env.XDG_DATA_HOME = join(isolatedHome, 'xdg-data')
    process.env.XDG_CONFIG_HOME = join(isolatedHome, 'xdg-config')
    await Promise.all([
      mkdir(process.env.DSH_HOME, { recursive: true }),
      mkdir(process.env.XDG_DATA_HOME, { recursive: true }),
      mkdir(process.env.XDG_CONFIG_HOME, { recursive: true }),
    ])
    const adapter = new OpenCodeGoAdapter(REAL_MODEL_CONFIG)
    realAdapter = adapter
    realHarness = await mountHarness(
      adapter,
      REAL_MODEL_CONFIG.provider,
      REAL_MODEL_CONFIG.model,
      {},
      8,
    )
  }, 30_000)

  afterAll(async () => {
    const credentialPersisted = await restoreRealEnvironment()
    expect(credentialPersisted).toBe(false)
  }, 30_000)

  it(
    'real first summary: generates from old context and recalls after removing the source',
    { timeout: 180_000 },
    async () => {
      if (!REAL_MODEL_CONFIG || !realHarness) throw new Error('real-model harness not mounted')
      logRealModelTarget('first-summary-recall')
      const requestOffset = realAdapter?.requestDiagnostics.length ?? 0
      const responseOffset = realAdapter?.responseDiagnostics.length ?? 0
      const agent = await realHarness.ctx.agentLoop.create(
        SessionId('matrix-real-first-summary'),
        {
          provider: REAL_MODEL_CONFIG.provider,
          model: REAL_MODEL_CONFIG.model,
          maxTokens: 1800,
        },
      )
      const firstTurnText = [
        `Recovery phrase: ${RECOVERY_PHRASE}`,
        longHistory('first project phase'),
      ].join('\n')
      const firstTurnPrompt = setupTurn(firstTurnText)

      await followup(realHarness, agent, firstTurnPrompt)
      assertNoPrematureCompress(agent.session, 'first setup turn')
      await followup(realHarness, agent, setupTurn(longHistory('second project phase')))
      assertNoPrematureCompress(agent.session, 'second setup turn')
      await followup(realHarness, agent, setupTurn(longHistory('third project phase')))
      assertNoPrematureCompress(agent.session, 'third setup turn')
      const compressPrompt =
        'Call the `compress` tool now with one content entry for the closed range m0001..m0002. Write its summary yourself from the visible conversation; no summary text is provided. Preserve every exact identifier and its meaning. After the tool result, reply only READY and do not repeat any stored fact.'
      expect(compressPrompt).not.toContain(RECOVERY_PHRASE)
      await followup(realHarness, agent, compressPrompt)

      const calls = compressCalls(agent.session)
      const requestedTurnCalls = calls.filter((call) => call.data.turn === 4)
      assertReal(
        requestedTurnCalls.length === 1,
        'the explicit compression turn must contain exactly one compress call',
        agent.session,
      )
      const firstArgs = parseRealCompressArguments(requestedTurnCalls[0]!, agent.session)
      const firstRange = firstArgs.content?.[0]
      assertReal(
        firstArgs.content?.length === 1 &&
          firstRange?.startRef === 'm0001' &&
          firstRange?.endRef === 'm0002',
        'the model did not generate exactly the requested m0001..m0002 range',
        agent.session,
      )
      if (!firstRange) throw new Error('generated summary entry missing')
      const firstGenerated = firstRange.summary.includes(RECOVERY_PHRASE)
      assertReal(
        firstGenerated,
        'the model-generated summary omitted the recovery phrase',
        agent.session,
      )
      assertReal(
        firstRange.summary.length < firstTurnPrompt.length,
        'the generated summary did not reduce the original source text',
        agent.session,
      )
      const block1 = checkpoints(agent.session).find((record) => record.meta.blockRef === 'b1')
      assertReal(block1 !== undefined, 'the first compression did not create b1', agent.session)
      assertReal(
        block1.text.includes(RECOVERY_PHRASE),
        'b1 did not preserve the recovery phrase',
        agent.session,
      )
      assertReal(
        reduceDcpState(agent.session.snapshotEvents()).activeBlockRefs.includes('b1'),
        'b1 is not active after the first compression',
        agent.session,
      )
      const readyAfterCompress = assistantTextForTurn(agent.session, 4)
        .toUpperCase()
        .includes('READY')
      const readyTextAfterCompress = assistantTextForTurn(agent.session, 4)
      assertReal(
        readyAfterCompress && !readyTextAfterCompress.includes(RECOVERY_PHRASE),
        'the model did not acknowledge the native result with fact-free READY',
        agent.session,
      )

      const visible = agent.session.deriveMessages()
      assertReal(
        !visible.some(
          (message) =>
            message.source.kind === 'user' && messageText(message) === firstTurnPrompt,
        ),
        'the original source turn is still visible after checkpoint commit',
        agent.session,
      )
      const visibleUserText = visible
        .filter((message) => message.source.kind === 'user')
        .map(messageText)
        .join('\n')
      assertReal(
        !visibleUserText.includes(RECOVERY_PHRASE),
        'the source fact remains visible outside DCP checkpoint messages',
        agent.session,
      )
      const visibleOutsideB1 = visibleTextOutsideCheckpoints(agent.session, ['b1'])
      assertReal(
        !visibleOutsideB1.includes(RECOVERY_PHRASE),
        'the recovery phrase has a visible carrier outside checkpoint b1',
        agent.session,
      )
      const recallPrompt = 'What exact recovery phrase did I ask you to retain?'
      expect(recallPrompt).not.toContain(RECOVERY_PHRASE)
      await followup(realHarness, agent, recallPrompt)
      const recalled = assistantTextForTurn(agent.session, 5).includes(RECOVERY_PHRASE)
      assertReal(
        recalled,
        'the model did not recall the phrase from the checkpoint',
        agent.session,
      )
      emitRealModelMetrics('first-summary-recall', requestOffset, responseOffset, {
        firstGenerated,
        partialTriggered: false,
        failedOnlyRetry: false,
        nestedVerbatim: false,
        recall: recalled,
      })
    },
  )

  it(
    'real partial/nested: retries only the timeout, carries b1 verbatim, then recalls both facts',
    { timeout: 180_000 },
    async () => {
      if (!REAL_MODEL_CONFIG || !realHarness) throw new Error('real-model harness not mounted')
      logRealModelTarget('partial-retry-nested-recall')
      const requestOffset = realAdapter?.requestDiagnostics.length ?? 0
      const responseOffset = realAdapter?.responseDiagnostics.length ?? 0
      const agent = await realHarness.ctx.agentLoop.create(
        SessionId('matrix-real-partial-nested'),
        {
          provider: REAL_MODEL_CONFIG.provider,
          model: REAL_MODEL_CONFIG.model,
          maxTokens: 4096,
        },
      )
      const firstTurnText = [
        `Recovery phrase: ${RECOVERY_PHRASE}`,
        longHistory('first multi-range phase'),
      ].join('\n')
      const secondTurnText = [
        `Ledger salt: ${LEDGER_SALT}`,
        longHistory('second multi-range phase'),
      ].join('\n')
      await followup(realHarness, agent, setupTurn(firstTurnText))
      assertNoPrematureCompress(agent.session, 'first multi-range setup turn')
      await followup(realHarness, agent, setupTurn(secondTurnText))
      assertNoPrematureCompress(agent.session, 'second multi-range setup turn')
      await followup(realHarness, agent, setupTurn(longHistory('third multi-range phase')))
      assertNoPrematureCompress(agent.session, 'third multi-range setup turn')

      const append = agent.session.append.bind(agent.session)
      let compactionStarts = 0
      let timedOut = false
      const appendSpy = vi
        .spyOn(agent.session, 'append')
        .mockImplementation((type, data, ...opts) => {
          if (type === 'compaction/start') {
            compactionStarts++
            if (compactionStarts === 2 && !timedOut) {
              timedOut = true
              throw new Error('timeout starting the second DCP range commit')
            }
          }
          return Reflect.apply(append, agent.session, [type, data, ...opts]) as ReturnType<
            typeof append
          >
        })
      try {
        await followup(
          realHarness,
          agent,
          'For the first call, invoke the `compress` tool with one content array containing exactly two entries: m0001..m0002 and m0002..m0003. Write each summary yourself from that range; no summary text is provided. Preserve every exact identifier and relevant fact. After a partial result, invoke `compress` only for the rejected range. After the final tool result, reply only READY without repeating stored facts.',
        )
      } finally {
        appendSpy.mockRestore()
      }

      const callsAfterPartial = compressCalls(agent.session)
      const turn4Calls = callsAfterPartial.filter((call) => call.data.turn === 4)
      assertReal(
        turn4Calls.length === 2,
        'turn 4 must contain exactly the initial call and one failed-range retry',
        agent.session,
      )
      const initialContent =
        parseRealCompressArguments(turn4Calls[0]!, agent.session).content ?? []
      assertReal(
        initialContent.length === 2 &&
          initialContent[0]?.startRef === 'm0001' &&
          initialContent[0]?.endRef === 'm0002' &&
          initialContent[1]?.startRef === 'm0002' &&
          initialContent[1]?.endRef === 'm0003',
        'the first compress call did not contain exactly m0001..m0002 and m0002..m0003',
        agent.session,
      )
      assertReal(
        timedOut,
        'the second commit did not reach the injected timeout',
        agent.session,
      )
      const partialTriggered =
        /status=partial; committed=b1; rejected=m0002\.\.m0003\[TIMEOUT\]/.test(
          resultForCall(agent.session, String(turn4Calls[0]!.data.callId)),
        )
      assertReal(
        partialTriggered,
        'the first result was not one-success/one-timeout partial',
        agent.session,
      )
      const retryContent =
        parseRealCompressArguments(turn4Calls[1]!, agent.session).content ?? []
      const failedOnlyRetry =
        retryContent.length === 1 &&
        retryContent[0]?.startRef === 'm0002' &&
        retryContent[0]?.endRef === 'm0003' &&
        !retryContent.some((entry) => entry.startRef === 'm0001')
      assertReal(
        failedOnlyRetry,
        'the model retried a committed range or changed the failed range',
        agent.session,
      )
      const block1 = checkpoints(agent.session).find((record) => record.meta.blockRef === 'b1')
      assertReal(
        block1 !== undefined,
        'the successful first range did not create b1',
        agent.session,
      )
      assertReal(
        block1.text.includes(RECOVERY_PHRASE),
        'b1 omitted the recovery phrase',
        agent.session,
      )
      const readyAfterPartial = assistantTextForTurn(agent.session, 4)
      assertReal(
        readyAfterPartial.toUpperCase().includes('READY') &&
          !readyAfterPartial.includes(RECOVERY_PHRASE) &&
          !readyAfterPartial.includes(LEDGER_SALT),
        'the model did not acknowledge the native retry result with fact-free READY',
        agent.session,
      )

      // The commit happens in turn 4; this filler turn makes b1 eligible under
      // the default retainRecentTurns=2 policy when nesting occurs in turn 6.
      await followup(realHarness, agent, setupTurn(longHistory('fourth multi-range phase')))
      assertReal(
        compressCalls(agent.session).length === 2,
        'the filler turn added an unexpected compress call',
        agent.session,
      )
      const nestedPrompt =
        'Call the `compress` tool with one content entry from checkpoint b1 through exclusive endRef m0005. Write a concise summary of the surrounding history only; do not copy the b1 summary into it because DCP carries prior checkpoint bodies forward automatically. After the tool result, reply only READY and do not repeat stored facts.'
      expect(nestedPrompt).not.toContain(RECOVERY_PHRASE)
      expect(nestedPrompt).not.toContain(LEDGER_SALT)
      await followup(realHarness, agent, nestedPrompt)

      const nestedCall = compressCalls(agent.session).findLast((call) => call.data.turn === 6)
      assertReal(
        nestedCall !== undefined,
        'the model did not issue a new turn-6 nested compress call',
        agent.session,
      )
      if (!nestedCall) throw new Error('nested compress call missing')
      const nestedContent = parseRealCompressArguments(nestedCall, agent.session).content ?? []
      assertReal(
        nestedContent[0]?.startRef === 'b1' && nestedContent[0]?.endRef === 'm0005',
        'the turn-6 nested range did not target b1..m0005',
        agent.session,
      )
      assertReal(
        resultForCall(agent.session, String(nestedCall.data.callId)).includes('status=success'),
        'the turn-6 nested call did not produce a successful tool result',
        agent.session,
      )
      const nested = checkpoints(agent.session).find(
        (record) => record.meta.compressCallId === String(nestedCall.data.callId),
      )
      assertReal(
        nested !== undefined,
        'the new turn-6 call did not create a nested checkpoint',
        agent.session,
      )
      const block2 = checkpoints(agent.session).find((record) => record.meta.blockRef === 'b2')
      assertReal(
        block2 !== undefined,
        'the failed range retry did not create b2',
        agent.session,
      )
      assertReal(
        nested.meta.consumedBlockRefs.includes('b1') &&
          nested.meta.consumedBlockRefs.includes('b2'),
        'the new nested checkpoint did not consume both prior blocks',
        agent.session,
      )
      const nestedVerbatim =
        nested.text.includes(block1.text) && nested.text.includes(block2.text)
      assertReal(
        nestedVerbatim,
        'the nested checkpoint did not carry b1 verbatim',
        agent.session,
      )
      const nestedState = reduceDcpState(agent.session.snapshotEvents())
      assertReal(
        nestedState.blocks.find((block) => block.ref === 'b1')?.membership === 'consumed',
        'b1 did not become consumed by the nested checkpoint',
        agent.session,
      )
      assertReal(
        nestedState.blocks.find((block) => block.ref === 'b2')?.membership === 'consumed',
        'b2 did not become consumed by the nested checkpoint',
        agent.session,
      )
      assertReal(
        nestedState.blocks.find((block) => block.ref === nested.meta.blockRef)?.membership ===
          'active',
        'the nested checkpoint is not active',
        agent.session,
      )
      const readyAfterNested = assistantTextForTurn(agent.session, 6)
      assertReal(
        readyAfterNested.toUpperCase().includes('READY') &&
          !readyAfterNested.includes(RECOVERY_PHRASE) &&
          !readyAfterNested.includes(LEDGER_SALT),
        'the model did not acknowledge the nested native result with fact-free READY',
        agent.session,
      )

      const recallPrompt = 'What exact recovery phrase and ledger salt did I ask you to retain?'
      expect(recallPrompt).not.toContain(RECOVERY_PHRASE)
      expect(recallPrompt).not.toContain(LEDGER_SALT)
      const visibleUserText = agent.session
        .deriveMessages()
        .filter((message) => message.source.kind === 'user')
        .map(messageText)
        .join('\n')
      assertReal(
        !visibleUserText.includes(RECOVERY_PHRASE),
        'the original recovery phrase remains user-visible',
        agent.session,
      )
      assertReal(
        !visibleUserText.includes(LEDGER_SALT),
        'the original ledger salt remains user-visible',
        agent.session,
      )
      const visibleOutsideNested = visibleTextOutsideCheckpoints(agent.session, [
        nested.meta.blockRef,
      ])
      assertReal(
        !visibleOutsideNested.includes(RECOVERY_PHRASE) &&
          !visibleOutsideNested.includes(LEDGER_SALT),
        'a fact has a visible carrier outside the final nested checkpoint',
        agent.session,
      )
      assertReal(
        nested.text.includes(RECOVERY_PHRASE) && nested.text.includes(LEDGER_SALT),
        'the final nested checkpoint did not carry both exact facts',
        agent.session,
      )
      await followup(realHarness, agent, recallPrompt)
      const answer = assistantTextForTurn(agent.session, 7)
      const recalled = answer.includes(RECOVERY_PHRASE) && answer.includes(LEDGER_SALT)
      assertReal(
        recalled,
        'the model did not recall both facts from the nested checkpoint',
        agent.session,
      )
      emitRealModelMetrics('partial-retry-nested-recall', requestOffset, responseOffset, {
        firstGenerated: block1.text.includes(RECOVERY_PHRASE),
        partialTriggered,
        failedOnlyRetry,
        nestedVerbatim,
        recall: recalled,
      })
    },
  )
})
