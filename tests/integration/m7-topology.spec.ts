import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import * as dcpPlugin from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'
import { ScriptedAdapter } from './agentloop-scripted.js'

let ctx: Context | undefined
let root: string | undefined

async function mount(): Promise<Context> {
  const next = new Context()
  await mountAgentLoopTestDependencies(next, {
    systemPrompt: { persona: 'You are a DCP stats topology test agent.' },
  })
  await next.plugin(TokenMeter)
  await next.plugin(CommandRuntime)
  await next.plugin(AgentLoop, { agents: [] })
  next.llm.registerAdapter(['scripted'], new ScriptedAdapter([{ text: 'hello reply' }]))
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

describe('M7.0: production topology for /dcp stats', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dcp-topology-'))
    ctx = await mount()
  })

  afterEach(async () => {
    if (ctx !== undefined) {
      await ctx.fiber.dispose()
      ctx = undefined
    }
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('turns unavailable into current when storage is provided late, via the real plugin path', async () => {
    if (!ctx || !root) throw new Error('harness missing')
    const agent = ctx.agentLoop.create(SessionId('topology-stats'), {
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

    const before = await ctx.commands.execute(
      agent,
      '/dcp stats',
      [],
      new AbortController().signal,
    )
    expect(before?.result.kind).toBe('success')
    expect(before?.result.text).toContain('persistent domain: unavailable')

    // Provide storage after the plugin is already loaded (late provide).
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson as unknown as Plugin, { root })
    await ctx.plugin(StorageDomain as unknown as Plugin, { backend: 'json' })

    let after: Awaited<ReturnType<typeof ctx.commands.execute>> | undefined
    for (let attempt = 0; attempt < 20; attempt++) {
      after = await ctx.commands.execute(agent, '/dcp stats', [], new AbortController().signal)
      if (after?.result.text?.includes('persistent domain: current')) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(after?.result.kind).toBe('success')
    expect(after?.result.text).toContain('persistent domain: current')
  })
})
