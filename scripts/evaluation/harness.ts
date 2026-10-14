/** Production dsh services; only the task's terminal backend is provided by Harbor. */
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import BasicCompactionEngine, {
  type BasicCompactionConfig,
} from '@deepseek-ai/dsh-compaction-basic'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import LlmRuntime, {
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as loopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import * as agentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as llmInvariant from '@deepseek-ai/dsh-llm/invariant'
import * as toolsInvariant from '@deepseek-ai/dsh-tools/invariant'
import * as promptInvariant from '@deepseek-ai/dsh-system-prompt/invariant'
import * as compactionInvariant from '@deepseek-ai/dsh-compaction/invariant'
import * as dcpPlugin from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'
import {
  OpenCodeGoAdapter,
  type OpenCodeGoAttemptEvent,
} from '../../tests/e2e-real/opencode-go-adapter.js'
import { readRealModelConfig, type RealModelConfig } from '../real-model-config.js'
import { createLedger, type RunDescriptor, type RunRecord } from './ledger.js'
import { priceAt } from './pricing.js'
import { evaluateRequest } from './budget.js'

export const EVALUATION_CONTEXT_WINDOW = 1_000_000
export const EVALUATION_MAX_OUTPUT = 4096
export const EVALUATION_NATIVE_COMPACTION = { auto: true, maxTokens: EVALUATION_MAX_OUTPUT }

class EvaluationAdapter extends OpenCodeGoAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (provider !== 'deepseek' || model !== 'deepseek-flash')
      throw new Error('The frozen evaluation supports only official deepseek/deepseek-flash')
    return {
      provider,
      id: model,
      name: model,
      context: { contextWindow: EVALUATION_CONTEXT_WINDOW },
      defaultMaxTokens: EVALUATION_MAX_OUTPUT,
    }
  }
}

class BoundedAdapter extends LlmAdapter {
  constructor(
    private readonly delegate: LlmAdapter,
    private readonly admit: (options: GenerateOptions) => string | null,
  ) {
    super()
  }
  override providerInfo(provider: string) {
    return this.delegate.providerInfo(provider)
  }
  override providerRetryPolicy(provider: string) {
    return this.delegate.providerRetryPolicy(provider)
  }
  override resolveModel(provider: string, model: string, signal?: AbortSignal) {
    return this.delegate.resolveModel(provider, model, signal)
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reason = this.admit(options)
    if (reason !== null) {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'EVALUATION_LIMIT', message: reason } },
      }
      return
    }
    yield* this.delegate.stream(options)
  }
}

export interface TerminalResult {
  stdout: string
  stderr: string
  returnCode: number
}

export interface TaskOptions {
  descriptor: RunDescriptor
  instruction: string
  cwd: string
  dcpEnabled: boolean
  /** Closed, public replay/fork history; copied by the official agent factory. */
  seed?: readonly SessionEvent[]
  dcpConfig?: Parameters<typeof resolveConfig>[0]
  /** Experiment-only tool gate; automatic DCP modifications must be off in both arms. */
  compressionPermission?: 'active' | 'inactive'
  maxRequests: number
  deadlineMs: number
  maxCostUSD?: number
  modelConfig?: RealModelConfig
  adapterFactory?: (onAttempt: (event: OpenCodeGoAttemptEvent) => void) => LlmAdapter
  terminal(command: string, timeoutSec: number, signal?: AbortSignal): Promise<TerminalResult>
  onSessionEvent?: (event: SessionEvent) => void
  onContext?: (context: Context) => void
  onLedger?: (record: RunRecord) => void
  nativeCompactionConfig?: BasicCompactionConfig
}

export async function runTask(options: TaskOptions) {
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1)
    throw new Error('maxRequests must be positive')
  if (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0)
    throw new Error('deadlineMs must be positive')
  const maxCost = options.maxCostUSD ?? 1
  if (!Number.isFinite(maxCost) || maxCost <= 0) throw new Error('maxCostUSD must be positive')
  if (!options.cwd.startsWith('/') || !options.instruction.trim())
    throw new Error('Task needs an absolute container cwd and an instruction')
  const dcpConfig = resolveConfig(options.dcpConfig ?? { enabled: options.dcpEnabled })
  if (dcpConfig.enabled !== options.dcpEnabled)
    throw new Error('dcpConfig.enabled must match dcpEnabled')
  if (
    options.compressionPermission !== undefined &&
    (!dcpConfig.enabled ||
      !dcpConfig.manualMode.default ||
      dcpConfig.manualMode.automaticStrategies)
  )
    throw new Error(
      'Compression permission requires DCP manual mode without automatic strategies',
    )
  const ctx = new Context()
  const ledger = createLedger(options.descriptor, priceAt(Date.now(), options.descriptor.model))
  const physicalRequests = new Map<number, string>()
  const requestReservations = new Map<number, number>()
  let nextReservation = 0
  let unknownCostReservation = 0
  let budgetReason: string | null = null
  const monotonicStart = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const onAttempt = (event: OpenCodeGoAttemptEvent) => {
    if (event.phase === 'start') {
      const sessionId = event.sessionId ?? options.descriptor.runId
      const session = ctx.sessions.get(SessionId(sessionId))
      const step = session?.snapshotEvents().findLast((item) => item.type === 'step/start')
      const attemptId = ledger.startAttempt({
        agentId: String(ctx.agents.get(SessionId(sessionId))?.id ?? sessionId),
        sessionId,
        purpose: event.purpose ?? 'conversation',
        startedAt: event.startedAt,
        requestHash: event.requestHash,
        ...(step?.type === 'step/start' ? { turn: step.data.turn, step: step.data.step } : {}),
      })
      physicalRequests.set(event.requestId, attemptId)
      requestReservations.set(event.requestId, nextReservation)
    } else {
      const attemptId = physicalRequests.get(event.requestId)
      if (!attemptId) throw new Error('Provider response has no matching physical attempt')
      const providerTime =
        event.providerCreated === undefined ? undefined : event.providerCreated * 1000
      const pricingTime =
        providerTime !== undefined && Math.abs(providerTime - event.startedAt) < 60_000
          ? providerTime
          : event.startedAt
      ledger.finishAttempt(attemptId, {
        status: event.status,
        finishedAt: event.finishedAt,
        ...(event.usage === undefined ? {} : { usage: event.usage }),
        prices: priceAt(pricingTime, event.model),
      })
      if (!event.usage) unknownCostReservation += requestReservations.get(event.requestId) ?? 0
    }
    options.onLedger?.(ledger.snapshot())
  }

  try {
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, {
      personaPrefix:
        'You are an autonomous agent completing a terminal task. Work in the task environment using the terminal tool, verify your result, and finish when the task is complete.',
    })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(CommandRuntime)
    for (const plugin of [
      sessionInvariant,
      loopInvariant,
      agentInvariant,
      llmInvariant,
      toolsInvariant,
      promptInvariant,
      compactionInvariant,
    ])
      await ctx.plugin(plugin as unknown as Plugin)
    const config =
      options.modelConfig ?? (options.adapterFactory ? undefined : readRealModelConfig())
    if (!options.adapterFactory && !config)
      throw new Error('Official DeepSeek credential is missing')
    const delegate = options.adapterFactory
      ? options.adapterFactory(onAttempt)
      : new EvaluationAdapter({ ...config!, onAttempt })
    const info = await delegate.resolveModel(
      options.descriptor.provider,
      options.descriptor.model,
    )
    if (info.context?.contextWindow !== EVALUATION_CONTEXT_WINDOW)
      throw new Error('Native compaction requires the frozen model context metadata')
    const worstCasePrices = priceAt(
      Date.parse('2026-10-14T06:00:00Z'),
      options.descriptor.model,
    )
    const adapter = new BoundedAdapter(delegate, (request) => {
      const snapshot = ledger.snapshot()
      // A conservative UTF-8 byte bound, including serialization overhead, reserves
      // the next full output at peak rates. Actual billing still uses provider usage.
      const inputUpperBound =
        Buffer.byteLength(
          JSON.stringify({
            system: request.system,
            messages: request.messages,
            tools: request.tools,
          }),
        ) + 1024
      budgetReason = evaluateRequest(
        {
          attemptCount: snapshot.attempts.length,
          knownCost: snapshot.knownCost + unknownCostReservation,
          inputEstimateTokens: inputUpperBound,
          nextMaxOutputTokens: request.maxTokens ?? EVALUATION_MAX_OUTPUT,
          elapsedMs: performance.now() - monotonicStart,
        },
        {
          maxRequests: options.maxRequests,
          maxCostUSD: maxCost,
          maxElapsedMs: options.deadlineMs,
          prices: worstCasePrices,
        },
      )
      nextReservation =
        (inputUpperBound * worstCasePrices.rates.uncachedInputPerMillion +
          (request.maxTokens ?? EVALUATION_MAX_OUTPUT) *
            worstCasePrices.rates.outputPerMillion) /
        1_000_000
      return budgetReason
    })
    ctx.llm.registerAdapter([options.descriptor.provider], adapter)
    ctx.tools.register(
      defineTool({
        name: 'terminal',
        description: `Execute a shell command in the task container. Initial working directory: ${options.cwd}. Use commands to inspect files, edit them and verify your work.`,
        parameters: {
          command: { type: 'string', required: true, description: 'Shell command to execute' },
          timeoutSec: {
            type: 'number',
            description: 'Command timeout in seconds, from 1 to 120; default 30',
          },
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args, exec) {
          const { command, timeoutSec = 30 } = args
          if (!Number.isFinite(timeoutSec) || timeoutSec < 1 || timeoutSec > 120)
            throw new Error('timeoutSec must be between 1 and 120')
          const result = await options.terminal(command, timeoutSec, exec.signal)
          const clip = (text: string) =>
            text.length <= 40_000
              ? text
              : `${text.slice(0, 30_000)}\n[terminal output clipped; use narrower commands]\n${text.slice(-10_000)}`
          return JSON.stringify({
            stdout: clip(result.stdout),
            stderr: clip(result.stderr),
            returnCode: result.returnCode,
          })
        },
      }),
    )
    await ctx.plugin(BasicCompactionEngine, {
      ...EVALUATION_NATIVE_COMPACTION,
      ...options.nativeCompactionConfig,
    })
    await ctx.plugin(dcpPlugin as unknown as Plugin, dcpConfig)
    if (options.compressionPermission === 'inactive')
      ctx.tools.guard((exec) =>
        exec.name === 'compress'
          ? 'Compression is inactive for this experimental continuation.'
          : undefined,
      )
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.on('session/event', (_session, event) => options.onSessionEvent?.(event))
    options.onContext?.(ctx)
    const { agent } = await ctx.agents.create({
      sessionId: SessionId(options.descriptor.runId),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      agentOptions: {
        provider: options.descriptor.provider,
        model: options.descriptor.model,
        maxTokens: EVALUATION_MAX_OUTPUT,
      },
      meta: { cwd: options.cwd },
    })
    timer = setTimeout(() => {
      budgetReason = 'deadline'
      agent.cancel({ kind: 'hook', reason: 'evaluation_deadline' })
    }, options.deadlineMs)
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: options.instruction }],
        source: { kind: 'user' },
      }),
    )
    await agent.whenIdle()
    const events = agent.session.snapshotEvents()
    const end = events.findLast((event) => event.type === 'turn/end')
    const completed = end?.type === 'turn/end' && end.data.reason.kind === 'completed'
    const status =
      budgetReason !== null
        ? ('budget_exceeded' as const)
        : completed
          ? ('completed' as const)
          : ('error' as const)
    const record = ledger.finishRun({
      outcome: status === 'budget_exceeded' ? 'budget_exceeded' : 'failure',
      finishedAt: Date.now(),
    })
    options.onLedger?.(record)
    return {
      ledger: record,
      verification: 'pending' as const,
      execution: {
        status,
        requestCount: record.attempts.length,
        reason: budgetReason ?? (completed ? null : (end?.data.reason.kind ?? 'no_turn')),
      },
      nativeCompaction: { enabled: true, auto: true, contextWindow: EVALUATION_CONTEXT_WINDOW },
      events,
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (ledger.snapshot().outcome === null) {
      const record = ledger.finishRun({
        outcome: 'infrastructure_error',
        finishedAt: Date.now(),
      })
      options.onLedger?.(record)
    }
    await ctx.fiber.dispose()
  }
}
