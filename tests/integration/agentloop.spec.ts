import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as agentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import * as compactionInvariant from '@deepseek-ai/dsh-compaction/invariant'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import * as dcpPlugin from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { controlMessage } from '../../src/strategies/control.js'
import { ScriptedAdapter } from './agentloop-scripted.js'

let ctx: Context | undefined
let adapter: ScriptedAdapter | undefined

async function mountHarness(): Promise<Context> {
  const next = new Context()
  await next.plugin(InvariantRegistry)
  await mountAgentLoopTestDependencies(next, {
    systemPrompt: { persona: 'You are a deterministic DCP test agent.' },
  })
  await next.plugin(sessionInvariant as unknown as Plugin)
  await next.plugin(agentLoopInvariant as unknown as Plugin)
  await next.plugin(compactionInvariant as unknown as Plugin)
  await next.plugin(TokenMeter)
  await next.plugin(CommandRuntime)
  await next.plugin(AgentLoop, { agents: [] })
  adapter = new ScriptedAdapter([
    { text: 'first reply' },
    {
      toolCalls: [
        {
          id: 'dcp-call',
          name: 'compress',
          arguments: JSON.stringify({
            topic: 't',
            content: [{ startRef: 'm0001', endRef: 'm0002', summary: 'deterministic summary' }],
          }),
        },
      ],
    },
    { text: 'compression done' },
  ])
  next.llm.registerAdapter(['scripted'], adapter)
  await next.plugin(
    dcpPlugin as unknown as Plugin,
    resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 } }),
  )
  return next
}

function waitForIdle(agent: { id: string }): Promise<void> {
  return new Promise((resolve) => {
    if (!ctx) return resolve()
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

describe('deterministic AgentLoop matrix (M6.0)', () => {
  beforeEach(async () => {
    ctx = await mountHarness()
  })

  afterEach(async () => {
    if (ctx !== undefined) {
      await ctx.fiber.dispose()
      ctx = undefined
    }
    adapter = undefined
  })

  it('drives compress through the real agent loop with a scripted adapter', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    const agent = ctx.agentLoop.create(SessionId('deterministic-dcp'), {
      provider: 'scripted',
      model: 'scripted',
    })

    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'first turn content' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'second turn: call compress with m0001..m0002' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    const events = [...agent.session.events]
    expect(
      events.some((event) => event.type === 'tool/call' && event.data.name === 'compress'),
    ).toBe(true)
    const state = reduceDcpState(events)
    expect(state.activeBlockRefs).toEqual(['b1'])

    const text = agent.session
      .deriveMessages()
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('deterministic summary')
    expect(text).not.toContain('first turn content')

    const command = await ctx.commands.execute(
      agent,
      '/dcp context',
      new AbortController().signal,
    )
    expect(command?.result.kind).toBe('success')

    // Restart reconstruction agrees with the live surface.
    const restored = Session.create(SessionId(agent.session.id), structuredClone(events))
    expect(restored.deriveMessages()).toEqual(agent.session.deriveMessages())
  })

  it('consumes control turns without any LLM dispatch', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    const agent = ctx.agentLoop.create(SessionId('control-sweep'), {
      provider: 'scripted',
      model: 'scripted',
    })
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)
    const dispatchesBefore = adapter.dispatchCount
    agent.followup(controlMessage('sweep'))
    await waitForIdle(agent)
    expect(adapter.dispatchCount).toBe(dispatchesBefore)
    expect(
      [...agent.session.events].filter((event) => event.type === 'assistant/message'),
    ).toHaveLength(1)
  })

  it('commands fail closed on illegal arguments and register dcp-compress', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    const agent = ctx.agentLoop.create(SessionId('command-matrix'), {
      provider: 'scripted',
      model: 'scripted',
    })

    expect(ctx.commands.find(agent, 'dcp-compress')).toBeDefined()
    const unknown = await ctx.commands.execute(
      agent,
      '/dcp unknown',
      new AbortController().signal,
    )
    expect(unknown?.result.kind).toBe('error')
    const missingShow = await ctx.commands.execute(
      agent,
      '/dcp show',
      new AbortController().signal,
    )
    expect(missingShow?.result.kind).toBe('error')
    const badShow = await ctx.commands.execute(
      agent,
      '/dcp show x',
      new AbortController().signal,
    )
    expect(badShow?.result.kind).toBe('error')
    const manual = await ctx.commands.execute(
      agent,
      '/dcp manual status',
      new AbortController().signal,
    )
    expect(manual?.result.kind).toBe('success')
    expect(manual?.result.text).toContain('OFF')
  })
})
