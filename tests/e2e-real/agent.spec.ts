import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import * as dcpPlugin from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { OpenCodeGoAdapter } from './opencode-go-adapter.js'

const enabled =
  process.env.DSH_DCP_REAL_MODEL === '1' && Boolean(process.env.OPENCODE_GO_API_KEY)

let ctx: Context | undefined
let tempRoot: string | undefined
const originalDshHome = process.env.DSH_HOME
const originalXdgData = process.env.XDG_DATA_HOME
const originalXdgConfig = process.env.XDG_CONFIG_HOME

beforeAll(async () => {
  if (!enabled) return
  tempRoot = await mkdtemp(join(tmpdir(), 'dsh-dcp-real-'))
  process.env.DSH_HOME = join(tempRoot, 'dsh-home')
  process.env.XDG_DATA_HOME = join(tempRoot, 'xdg-data')
  process.env.XDG_CONFIG_HOME = join(tempRoot, 'xdg-config')

  const next = new Context()
  await mountAgentLoopTestDependencies(next, {
    systemPrompt: {
      persona:
        'You are a DCP integration test agent. Follow instructions exactly; when asked, call the compress tool with the exact refs given.',
    },
  })
  await next.plugin(TokenMeter)
  await next.plugin(CommandRuntime)
  await next.plugin(AgentLoop, { agents: [] })
  next.llm.registerAdapter(
    ['go'],
    new OpenCodeGoAdapter({
      baseUrl: process.env.DSH_DCP_LLM_BASE_URL ?? 'https://opencode.ai/zen/go/v1',
      apiKey: process.env.OPENCODE_GO_API_KEY!,
      model: process.env.DSH_DCP_LLM_MODEL ?? 'deepseek-v4-flash',
    }),
  )
  await next.plugin(
    dcpPlugin as unknown as Plugin,
    resolveConfig({
      debug: true,
      compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 },
    }),
  )
  ctx = next
})

afterAll(async () => {
  if (ctx !== undefined) {
    await ctx.fiber.dispose()
    ctx = undefined
  }
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  if (originalXdgData === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = originalXdgData
  if (originalXdgConfig === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = originalXdgConfig
  if (tempRoot !== undefined) await rm(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
})

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

describe.skipIf(!enabled)('real agent + real model (opencode go, isolated env)', () => {
  it('drives the compress tool through the real agent loop and verifies the surface', async () => {
    if (!ctx) throw new Error('harness not mounted')
    const agent = ctx.agentLoop.create(SessionId('real-dcp'), {
      provider: 'go',
      model: 'deepseek-v4-flash',
      maxTokens: 1500,
    })
    const globalCompress = ctx.tools.get('compress')
    const agentCompress = agent.ctx.tools.get('compress')
    expect(globalCompress?.name).toBe('compress')
    expect(agentCompress?.name).toBe('compress')

    agent.followup(
      createUserMessage({
        content: [
          { type: 'text', text: 'First turn: introduce this project in one sentence.' },
        ],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    agent.followup(
      createUserMessage({
        content: [
          {
            type: 'text',
            text: 'Second turn: call the compress tool with startRef "m0001", endRef "m0002", topic "first turn", and summary "compressed first turn". Then reply in one line.',
          },
        ],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    let events = [...agent.session.events]
    let compressCalls = events.filter(
      (event) => event.type === 'tool/call' && event.data.name === 'compress',
    )
    const assistantText = () =>
      agent.session.events
        .filter((event) => event.type === 'assistant/message')
        .map((event) =>
          event.data.message.content
            .filter((block) => block.type === 'text')
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join(' '),
        )
        .join(' | ')

    const invocation =
      '<invoke name="compress">' +
      '<parameter name="startRef">m0001</parameter>' +
      '<parameter name="endRef">m0002</parameter>' +
      '<parameter name="topic">first turn</parameter>' +
      '<parameter name="summary">compressed first turn</parameter>' +
      '</invoke>'
    let attempts = 0
    while (compressCalls.length === 0 && attempts < 3) {
      attempts++
      agent.followup(
        createUserMessage({
          content: [
            {
              type: 'text',
              text:
                'You did not call the compress tool. Output ONLY the exact XML invocation below and nothing else:\n' +
                invocation,
            },
          ],
          source: { kind: 'user' },
        }),
      )
      await waitForIdle(agent)
      events = [...agent.session.events]
      compressCalls = events.filter(
        (event) => event.type === 'tool/call' && event.data.name === 'compress',
      )
    }
    expect(compressCalls.length, assistantText()).toBeGreaterThan(0)

    const state = reduceDcpState(events)
    const toolResults = events
      .filter((event) => event.type === 'tool/result')
      .map(
        (event) =>
          `${event.data.message.content[0]?.isError ? '[ERROR] ' : ''}${event.data.message.content[0]?.content
            .filter((block) => block.type === 'text')
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join(' ')}`,
      )
    expect(state.activeBlockRefs.length, toolResults.join(' | ')).toBeGreaterThanOrEqual(1)
    expect(state.blocks[0]?.meta.kind).toBe('summary')

    const text = agent.session
      .deriveMessages()
      .flatMap((message) => message.content)
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('compressed first turn')
    expect(text).not.toContain('introduce this project in one sentence')

    // Commands run against the real agent session.
    const contextResult = await ctx.commands.execute(
      agent,
      '/dcp context',
      new AbortController().signal,
    )
    expect(contextResult?.result.kind).toBe('success')
    const manualResult = await ctx.commands.execute(
      agent,
      '/dcp manual on',
      new AbortController().signal,
    )
    expect(manualResult?.result.kind).toBe('success')
    expect(reduceDcpState([...agent.session.events]).manualMode).toBe(true)
  }, 240_000)
})
