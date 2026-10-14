import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as agentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import * as compactionInvariant from '@deepseek-ai/dsh-compaction/invariant'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as dcpPlugin from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'
import { controlMessage, isDcpControlMessage } from '../../src/strategies/control.js'
import { ScriptedAdapter, type ScriptedStep } from './agentloop-scripted.js'

interface HarnessOptions {
  config?: unknown
  script: ScriptedStep[]
  beforeDcp?: (ctx: Context) => void
  afterDcp?: (ctx: Context) => void
}

async function mountHarness(options: HarnessOptions): Promise<{
  ctx: Context
  adapter: ScriptedAdapter
  dispose(): Promise<void>
}> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { personaPrefix: 'You are a deterministic DCP pre-step test agent.' },
  })
  await ctx.plugin(sessionInvariant as unknown as Plugin)
  await ctx.plugin(agentLoopInvariant as unknown as Plugin)
  await ctx.plugin(compactionInvariant as unknown as Plugin)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentLoop, { agents: [] })

  const adapter = new ScriptedAdapter(options.script)
  ctx.llm.registerAdapter(['scripted'], adapter)
  options.beforeDcp?.(ctx)
  await ctx.plugin(dcpPlugin as unknown as Plugin, resolveConfig(options.config ?? {}))
  options.afterDcp?.(ctx)

  return {
    ctx,
    adapter,
    dispose: async () => ctx.fiber.dispose(),
  }
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

function registerContinueTool(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'continue',
      description: 'Complete a deterministic tool step.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => 'continued',
    }),
  )
}

describe('real AgentLoop pre-step regressions', () => {
  let dispose: (() => Promise<void>) | undefined

  afterEach(async () => {
    await dispose?.()
    dispose = undefined
  })

  it('defaults to turn granularity and adds one boundary across a multi-step turn', async () => {
    const harness = await mountHarness({
      script: [
        { toolCalls: [{ id: 'continue-call', name: 'continue', arguments: '{}' }] },
        { text: 'finished after the tool step' },
      ],
    })
    dispose = harness.dispose
    registerContinueTool(harness.ctx)
    const agent = await harness.ctx.agentLoop.create(SessionId('pre-step-turn-granularity'), {
      provider: 'scripted',
      model: 'scripted',
    })

    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'run the deterministic tool' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(harness.ctx, agent)

    expect(resolveConfig({}).references.granularity).toBe('turn')
    const boundaryMessages = agent.session
      .snapshotEvents()
      .filter(
        (event) =>
          event.type === 'user/message' &&
          event.data.source.kind === 'dsh-dcp' &&
          event.data.content.some(
            (block) => block.type === 'text' && block.text.includes('<dcp-boundary'),
          ),
      )
    expect(boundaryMessages).toHaveLength(1)
    expect(harness.adapter.dispatchCount).toBe(2)
  })

  it('does not inject boundary markers when compression is disabled', async () => {
    const harness = await mountHarness({
      config: { compress: { enabled: false } },
      script: [{ text: 'compression is disabled' }],
    })
    dispose = harness.dispose
    const agent = await harness.ctx.agentLoop.create(SessionId('pre-step-compress-disabled'), {
      provider: 'scripted',
      model: 'scripted',
    })

    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'ordinary request' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(harness.ctx, agent)

    expect(harness.ctx.tools.get('compress')).toBeUndefined()
    const assembly = await harness.ctx.systemPrompt.assemble()
    expect(assembly.sections.some((section) => section.name === 'dcp:guidance')).toBe(false)
    expect(
      agent.session
        .snapshotEvents()
        .some(
          (event) =>
            event.type === 'user/message' &&
            event.data.source.kind === 'dsh-dcp' &&
            event.data.content.some(
              (block) => block.type === 'text' && block.text.includes('<dcp-boundary'),
            ),
        ),
    ).toBe(false)
  })

  it('preserves startsRequestSeries returned by an inner pre-step listener', async () => {
    const harness = await mountHarness({
      script: [{ text: 'start a new request series' }],
      afterDcp(ctx) {
        ctx.on('agent/pre-step', async (_payload, next) => {
          const decision = await next()
          return decision.kind === 'enter'
            ? { ...decision, startsRequestSeries: true }
            : decision
        })
      },
    })
    dispose = harness.dispose
    const agent = await harness.ctx.agentLoop.create(SessionId('pre-step-request-series'), {
      provider: 'scripted',
      model: 'scripted',
    })

    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'begin a distinct request series' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(harness.ctx, agent)

    const firstHeader = agent.session
      .snapshotEvents()
      .find((event) => event.type === 'request/header')
    expect(firstHeader?.type).toBe('request/header')
    if (firstHeader?.type !== 'request/header') throw new Error('request header missing')
    expect(firstHeader.data.startsSeries).toBe(true)
  })

  it('does not run cleanup or a control command after an inner listener rejects the step', async () => {
    const harness = await mountHarness({
      script: [
        {
          toolCalls: [
            {
              id: 'pending-pre-step-cleanup',
              name: 'compress',
              arguments: JSON.stringify({
                topic: 'old context',
                content: [{ startRef: 'm0001', endRef: 'm0002', summary: 's'.repeat(6000) }],
              }),
            },
          ],
        },
        { text: 'must not be dispatched' },
      ],
      afterDcp(ctx) {
        ctx.on('tools/result', (execution) => {
          if (execution.name !== 'compress') return
          if (!execution.agent) throw new Error('compress test execution has no agent')
          execution.agent.inject(controlMessage('sweep'))
        })
        ctx.on('agent/pre-step', async ({ messages }, next) => {
          if (messages.some(isDcpControlMessage)) return { kind: 'reject' }
          return next()
        })
      },
    })
    dispose = harness.dispose
    const agent = await harness.ctx.agentLoop.create(SessionId('pre-step-reject'), {
      provider: 'scripted',
      model: 'scripted',
    })
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'request a compress call' }],
        source: { kind: 'user' },
      }),
    )

    await waitForIdle(harness.ctx, agent)

    const events = agent.session.snapshotEvents()
    expect(events.some((event) => event.type === 'compaction/prune')).toBe(false)
    expect(
      events.some((event) => event.type === 'turn/end' && event.data.reason.kind === 'blocked'),
    ).toBe(true)
    expect(harness.adapter.dispatchCount).toBe(1)
  })

  it('consumes a real control message while retaining an ordinary user message in the same batch', async () => {
    const ordinary = createUserMessage({
      content: [{ type: 'text', text: 'keep this user task' }],
      source: { kind: 'user' },
    })
    const harness = await mountHarness({
      script: [{ text: 'handled the user task' }],
    })
    dispose = harness.dispose
    const agent = await harness.ctx.agentLoop.create(SessionId('pre-step-control-and-user'), {
      provider: 'scripted',
      model: 'scripted',
    })

    agent.inject(ordinary)
    agent.followup(controlMessage('sweep'))
    await waitForIdle(harness.ctx, agent)

    expect(harness.adapter.dispatchCount).toBe(1)
    const derivedText = JSON.stringify(agent.session.deriveMessages())
    expect(derivedText).toContain('keep this user task')
    expect(derivedText).not.toContain('<dcp-control>sweep')
  })
})
