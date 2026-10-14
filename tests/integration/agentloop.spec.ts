import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as agentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import * as compactionInvariant from '@deepseek-ai/dsh-compaction/invariant'
import { Session, SessionId, type ToolResultMessage } from '@deepseek-ai/dsh-session'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import * as dcpPlugin from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { cleanupPendingCompressSteps } from '../../src/compress/step-cleanup.js'
import { controlMessage } from '../../src/strategies/control.js'
import { ScriptedAdapter } from './agentloop-scripted.js'

let ctx: Context | undefined
let adapter: ScriptedAdapter | undefined

async function mountHarness(options: { nativeCoexist?: boolean } = {}): Promise<Context> {
  const next = new Context()
  await next.plugin(InvariantRegistry)
  await mountAgentLoopTestDependencies(next, {
    systemPrompt: { personaPrefix: 'You are a deterministic DCP test agent.' },
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
  if (options.nativeCoexist) {
    let injected = false
    next.on('agent/pre-step', async ({ agent, turn }, nextListener) => {
      if (!injected && turn === 2) {
        injected = true
        const surface = [...agent.session.surface.nodes]
        const target = surface.find((seq) => {
          const event = agent.session.eventAt(seq)
          return (
            event?.type === 'user/message' &&
            event.data.content.some(
              (block) => block.type === 'text' && block.text.includes('ref="m0001"'),
            )
          )
        })
        if (target !== undefined) {
          const nativeId = CompactionId('native-coexist')
          agent.session.append('compaction/start', { compactionId: nativeId, turn })
          agent.session.append('compaction/summary', {
            compactionId: nativeId,
            summary: [{ type: 'text', text: 'native' }],
            shadowedRange: { start: target, end: target },
            shadowedSeqs: [target],
            shadowedTokenCount: 1,
            provider: 'scripted',
            model: 'scripted',
          })
          agent.session.append(
            'user/message',
            createUserMessage({
              content: [{ type: 'text', text: 'native' }],
              source: compactCheckpointSource(nativeId),
            }),
            {
              surfaceOp: { op: 'replace', startSeq: target, endSeq: target },
              sourceEventSeqs: [target],
            },
          )
          agent.session.append('compaction/end', { compactionId: nativeId, turn })
        }
      }
      return nextListener()
    })
  }
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

function toolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
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
    const agent = await ctx.agentLoop.create(SessionId('deterministic-dcp'), {
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

    const events = agent.session.snapshotEvents()
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
      [],
      new AbortController().signal,
    )
    expect(command?.result.kind).toBe('success')

    // Restart reconstruction agrees with the live surface.
    const restored = Session.create(SessionId(agent.session.id), structuredClone(events))
    expect(restored.deriveMessages()).toEqual(agent.session.deriveMessages())
  })

  it('consumes control turns without any LLM dispatch', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    const agent = await ctx.agentLoop.create(SessionId('control-sweep'), {
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
      agent.session.snapshotEvents().filter((event) => event.type === 'assistant/message'),
    ).toHaveLength(1)
  })

  it('commands fail closed on illegal arguments and register dcp-compress', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    const agent = await ctx.agentLoop.create(SessionId('command-matrix'), {
      provider: 'scripted',
      model: 'scripted',
    })

    expect(ctx.commands.find(agent, 'dcp-compress')).toBeDefined()
    const unknown = await ctx.commands.execute(
      agent,
      '/dcp unknown',
      [],
      new AbortController().signal,
    )
    expect(unknown?.result.kind).toBe('error')
    const missingShow = await ctx.commands.execute(
      agent,
      '/dcp show',
      [],
      new AbortController().signal,
    )
    expect(missingShow?.result.kind).toBe('error')
    const badShow = await ctx.commands.execute(
      agent,
      '/dcp show x',
      [],
      new AbortController().signal,
    )
    expect(badShow?.result.kind).toBe('error')
    const manual = await ctx.commands.execute(
      agent,
      '/dcp manual status',
      [],
      new AbortController().signal,
    )
    expect(manual?.result.kind).toBe('success')
    expect(manual?.result.text).toContain('OFF')
  })

  it('denies compress through the guard and prunes the rejected long payload', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    let deny = true
    ctx.tools.guard((execution) =>
      deny && execution.name === 'compress' ? 'denied for test' : undefined,
    )
    adapter.script = [
      { text: 'first' },
      {
        toolCalls: [
          {
            id: 'dcp-call',
            name: 'compress',
            arguments: JSON.stringify({
              topic: 't',
              content: [{ startRef: 'm0001', endRef: 'm0002', summary: 's'.repeat(1000) }],
            }),
          },
        ],
      },
      { text: 'after denial' },
    ]
    const agent = await ctx.agentLoop.create(SessionId('deny-compress'), {
      provider: 'scripted',
      model: 'scripted',
    })
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'turn one' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'call compress' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    const events = agent.session.snapshotEvents()
    const compressResult = events.find(
      (event) =>
        event.type === 'tool/result' &&
        events.some(
          (call) =>
            call.type === 'tool/call' &&
            String(call.data.callId) === String(event.data.message.source.callId),
        ),
    )
    expect(compressResult?.type).toBe('tool/result')
    if (compressResult?.type !== 'tool/result') throw new Error('compress result missing')
    expect(compressResult.data.message.isError).toBe(true)
    const deniedResultText = toolResultText(compressResult.data.message)
    expect(deniedResultText).toContain('status=rejected')
    expect(deniedResultText).toContain('[DENIED]')
    expect(deniedResultText).toContain('committed=none')
    expect(reduceDcpState(events).activeBlockRefs).toEqual([])
    expect(cleanupPendingCompressSteps(agent.session, ctx.tokenMeter)).toEqual([])
    const deniedText = JSON.stringify(agent.session.deriveMessages())
    expect(deniedText).not.toContain('"id":"dcp-call"')
    expect(deniedText).toContain('<dcp-cleanup')
    expect(deniedText).toContain('DENIED')
    deny = false
  })

  it('cleans a long summary when schema validation rejects the call before execute', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    const longSummary = 's'.repeat(4121)
    adapter.script = [
      { text: 'first' },
      {
        toolCalls: [
          {
            id: 'invalid-call',
            name: 'compress',
            arguments: JSON.stringify({
              topic: 't',
              content: [
                {
                  startRef: 'm0001',
                  endRef: 'm0002',
                  summary: longSummary,
                  extra: 'schema violation',
                },
              ],
            }),
          },
        ],
      },
      { text: 'after invalid compress' },
    ]
    const agent = await ctx.agentLoop.create(SessionId('invalid-compress-schema'), {
      provider: 'scripted',
      model: 'scripted',
    })
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'turn one' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'call compress with malformed entry' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    const events = agent.session.snapshotEvents()
    expect(
      events.some(
        (event) =>
          event.type === 'assistant/message' &&
          event.data.message.content.some(
            (block) => block.type === 'tool-call' && block.arguments.includes(longSummary),
          ),
      ),
    ).toBe(true)
    expect(cleanupPendingCompressSteps(agent.session, ctx.tokenMeter)).toEqual([])
    const derivedText = JSON.stringify(agent.session.deriveMessages())
    expect(derivedText).toContain('<dcp-cleanup')
    expect(derivedText).toContain('INVALID_ARGS')
    expect(derivedText).not.toContain(longSummary)
    const invalidResult = events.find(
      (event) =>
        event.type === 'tool/result' &&
        String(event.data.message.source.callId) === 'invalid-call',
    )
    expect(invalidResult?.type).toBe('tool/result')
    if (invalidResult?.type !== 'tool/result') throw new Error('invalid result missing')
    expect(invalidResult.data.message.isError).toBe(true)
    const invalidResultText = toolResultText(invalidResult.data.message)
    expect(invalidResultText).toContain('status=rejected')
    expect(invalidResultText).toContain('[INVALID_ARGS]')
    expect(invalidResultText).not.toContain(longSummary)
  })

  it('reports committed blocks when post-execute policy blocks after commit', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    ctx.on('tools/post-execute', async (exec, result, nextListener) => {
      if (exec.name === 'compress' && !result.isError) {
        return {
          kind: 'block',
          feedback: [{ type: 'text', text: 'post policy blocked after commit' }],
        }
      }
      return nextListener()
    })
    const agent = await ctx.agentLoop.create(SessionId('compress-post-policy-block'), {
      provider: 'scripted',
      model: 'scripted',
    })
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'turn one' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'compress turn one' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    const events = agent.session.snapshotEvents()
    const resultEvent = events.findLast(
      (event) =>
        event.type === 'tool/result' && event.data.message.source.callId === 'dcp-call',
    )
    expect(resultEvent?.type).toBe('tool/result')
    if (resultEvent?.type !== 'tool/result') throw new Error('compress result missing')
    expect(resultEvent.data.message.isError).toBe(true)
    const resultText = toolResultText(resultEvent.data.message)
    expect(resultText).toContain('status=success')
    expect(resultText).toContain('committed=b1')
    expect(resultText).toContain('correction=STOP')
    expect(resultText).toContain('do not retry committed ranges')
    expect(reduceDcpState(events).activeBlockRefs).toEqual(['b1'])
  })

  it('keeps the committed marker when cleanup first fails and policy then blocks', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    ctx.on('tools/post-execute', async (exec, result, nextListener) => {
      if (exec.name === 'compress' && !result.isError) {
        return {
          kind: 'block',
          feedback: [{ type: 'text', text: 'post policy blocked after cleanup failure' }],
        }
      }
      return nextListener()
    })
    const agent = await ctx.agentLoop.create(SessionId('compress-cleanup-then-policy-block'), {
      provider: 'scripted',
      model: 'scripted',
    })
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'turn one' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    let failedOnce = false
    const append = agent.session.append.bind(agent.session)
    const appendSpy = vi
      .spyOn(agent.session, 'append')
      .mockImplementation((type, data, ...opts) => {
        if (type === 'compaction/prune' && !failedOnce) {
          failedOnce = true
          throw new Error('simulated first cleanup failure')
        }
        return Reflect.apply(append, agent.session, [type, data, ...opts]) as ReturnType<
          typeof append
        >
      })
    try {
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: 'compress turn one' }],
          source: { kind: 'user' },
        }),
      )
      await waitForIdle(agent)
    } finally {
      appendSpy.mockRestore()
    }

    const events = agent.session.snapshotEvents()
    const resultEvent = events.findLast(
      (event) =>
        event.type === 'tool/result' && event.data.message.source.callId === 'dcp-call',
    )
    expect(resultEvent?.type).toBe('tool/result')
    if (resultEvent?.type !== 'tool/result') throw new Error('compress result missing')
    expect(resultEvent.data.message.isError).toBe(true)
    const resultText = toolResultText(resultEvent.data.message)
    expect(resultText).toContain('status=success')
    expect(resultText).toContain('committed=b1')
    expect(resultText).toContain('correction=STOP')

    expect(cleanupPendingCompressSteps(agent.session, ctx.tokenMeter)).toEqual([])
    const cleanupText = JSON.stringify(agent.session.deriveMessages())
    expect(cleanupText).toContain('<dcp-cleanup')
    expect(cleanupText).toContain('b1')
    expect(reduceDcpState(events).activeBlockRefs).toEqual(['b1'])
  })

  it('reports committed blocks when post-execute policy throws after commit', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    ctx.on('tools/post-execute', async (exec, result, nextListener) => {
      if (exec.name === 'compress' && !result.isError) {
        throw new Error('post policy threw after commit')
      }
      return nextListener()
    })
    const agent = await ctx.agentLoop.create(SessionId('compress-post-policy-throw'), {
      provider: 'scripted',
      model: 'scripted',
    })
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'turn one' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'compress turn one' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    const events = agent.session.snapshotEvents()
    const resultEvent = events.findLast(
      (event) =>
        event.type === 'tool/result' && event.data.message.source.callId === 'dcp-call',
    )
    expect(resultEvent?.type).toBe('tool/result')
    if (resultEvent?.type !== 'tool/result') throw new Error('compress result missing')
    expect(resultEvent.data.message.isError).toBe(true)
    const resultText = toolResultText(resultEvent.data.message)
    expect(resultText).toContain('status=success')
    expect(resultText).toContain('committed=b1')
    expect(resultText).toContain('correction=STOP')
    expect(reduceDcpState(events).activeBlockRefs).toEqual(['b1'])
  })

  it('aborts an in-flight turn without leaving DCP state', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    adapter.script = [{ text: 'first' }, { hang: true }]
    const agent = await ctx.agentLoop.create(SessionId('abort-turn'), {
      provider: 'scripted',
      model: 'scripted',
    })
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'turn one' }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: 'turn two that hangs' }],
        source: { kind: 'user' },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 150))
    agent.cancel({ kind: 'user' })
    await waitForIdle(agent)

    const events = agent.session.snapshotEvents()
    const lastTurnEnd = events.findLast((event) => event.type === 'turn/end')
    expect(lastTurnEnd?.type).toBe('turn/end')
    if (lastTurnEnd?.type === 'turn/end') {
      expect(lastTurnEnd.data.reason.kind).toBe('aborted')
    }
    expect(reduceDcpState(events).activeBlockRefs).toEqual([])
  })

  it('runs multiple compress calls in one assistant message with per-entry cleanup', async () => {
    if (!ctx || !adapter) throw new Error('harness not mounted')
    adapter.script = [
      { text: 'first' },
      { text: 'second' },
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'compress',
            arguments: JSON.stringify({
              topic: 't',
              content: [{ startRef: 'm0001', endRef: 'm0002', summary: 'first summary' }],
            }),
          },
          {
            id: 'c2',
            name: 'compress',
            arguments: JSON.stringify({
              topic: 't',
              content: [{ startRef: 'm0002', endRef: 'm0003', summary: 'second summary' }],
            }),
          },
        ],
      },
      { text: 'done' },
    ]
    const agent = await ctx.agentLoop.create(SessionId('multi-compress'), {
      provider: 'scripted',
      model: 'scripted',
    })
    for (const text of ['turn one', 'turn two', 'compress both ranges']) {
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }),
      )
      await waitForIdle(agent)
    }

    const events = agent.session.snapshotEvents()
    const state = reduceDcpState(events)
    expect(state.activeBlockRefs).toEqual(['b1', 'b2'])
    const text = agent.session
      .deriveMessages()
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('first summary')
    expect(text).toContain('second summary')
    expect(text).not.toContain('turn one')
    expect(text).not.toContain('turn two')
  })

  it('emits and consumes aliases after native compaction (coexist chain)', async () => {
    if (ctx !== undefined) await ctx.fiber.dispose()
    ctx = await mountHarness({ nativeCoexist: true })
    if (!ctx || !adapter) throw new Error('harness not mounted')
    adapter.script = [
      { text: 'first' },
      { text: 'second' },
      {
        toolCalls: [
          {
            id: 'dcp-call',
            name: 'compress',
            arguments: JSON.stringify({
              topic: 't',
              content: [{ startRef: 'm0001', endRef: 'm0003', summary: 'after native' }],
            }),
          },
        ],
      },
      { text: 'done' },
    ]
    const agent = await ctx.agentLoop.create(SessionId('native-coexist'), {
      provider: 'scripted',
      model: 'scripted',
    })
    for (const text of ['turn one', 'turn two', 'compress over the aliased range']) {
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }),
      )
      await waitForIdle(agent)
    }

    const events = agent.session.snapshotEvents()
    const native = events.find(
      (event) =>
        event.type === 'user/message' &&
        event.data.content.some((b) => b.type === 'text' && b.text === 'native'),
    )
    expect(native?.type).toBe('user/message')
    const state = reduceDcpState(events)
    if (native?.type === 'user/message') {
      expect(state.aliases).toContainEqual({ ref: 'm0001', seq: native.seq })
    }
    expect(state.activeBlockRefs).toEqual(['b1'])
    const text = agent.session
      .deriveMessages()
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('after native')
    expect(text).not.toContain('turn one')
    expect(text).not.toContain('turn two')
  })
})
