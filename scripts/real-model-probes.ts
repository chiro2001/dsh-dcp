/**
 * M6.2 real-model probes: N natural compress attempts through the real dsh
 * agent loop (opencode go / deepseek-v4-flash). Reports schema-valid and
 * committed rates; not a CI gate.
 */

import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import * as dcpPlugin from '../src/index.js'
import { resolveConfig } from '../src/config.js'
import { reduceDcpState } from '../src/protocol/replay.js'
import { OpenCodeGoAdapter } from '../tests/e2e-real/opencode-go-adapter.js'

const apiKey = process.env.OPENCODE_GO_API_KEY
if (!apiKey) {
  console.log('real-model-probes: OPENCODE_GO_API_KEY missing; skipping')
  process.exit(0)
}

const count = Number(process.env.DSH_DCP_PROBES ?? 5)
const baseUrl = process.env.DSH_DCP_LLM_BASE_URL ?? 'https://opencode.ai/zen/go/v1'
const model = process.env.DSH_DCP_LLM_MODEL ?? 'deepseek-v4-flash'

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

interface ProbeResult {
  schemaValid: boolean
  committed: boolean
  errorText?: string
}

async function probe(ctx: Context, index: number): Promise<ProbeResult> {
  const agent = ctx.agentLoop.create(SessionId(`probe-${index}-${Date.now()}`), {
    provider: 'go',
    model,
    maxTokens: 1000,
  })
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: 'First turn: say hello in one line.' }],
      source: { kind: 'user' },
    }),
  )
  await waitForIdle(ctx, agent)
  agent.followup(
    createUserMessage({
      content: [
        {
          type: 'text',
          text: 'Second turn: boundary markers m0001 and m0002 are visible. Use the compress tool on range m0001..m0002 with a short summary, then confirm in one line.',
        },
      ],
      source: { kind: 'user' },
    }),
  )
  await waitForIdle(ctx, agent)

  const events = [...agent.session.events]
  const compressCalls = events.filter(
    (event) => event.type === 'tool/call' && event.data.name === 'compress',
  )
  let schemaValid = false
  if (compressCalls.length > 0) {
    const call = compressCalls[0]!
    if (call.type === 'tool/call') {
      try {
        const parsed = JSON.parse(call.data.arguments) as {
          topic?: string
          content?: Array<{ startRef?: string; endRef?: string; summary?: string }>
        }
        schemaValid =
          typeof parsed.topic === 'string' &&
          Array.isArray(parsed.content) &&
          parsed.content.length > 0 &&
          parsed.content.every(
            (entry) =>
              typeof entry.startRef === 'string' &&
              typeof entry.endRef === 'string' &&
              typeof entry.summary === 'string',
          )
      } catch {
        schemaValid = false
      }
    }
  }
  const committed = reduceDcpState(events).activeBlockRefs.length > 0
  const errorResult = events.find(
    (event) => event.type === 'tool/result' && event.data.message.content[0]?.isError,
  )
  return {
    schemaValid,
    committed,
    ...(errorResult?.type === 'tool/result'
      ? {
          errorText: errorResult.data.message.content[0]?.content
            .filter((block) => block.type === 'text')
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join(' '),
        }
      : {}),
  }
}

async function main(): Promise<void> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: {
      persona:
        'You are a DCP probe agent. Follow tool instructions exactly; call compress with valid mNNNN refs.',
    },
  })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(
    ['go'],
    new OpenCodeGoAdapter({ baseUrl, apiKey: apiKey as string, model }),
  )
  await ctx.plugin(
    dcpPlugin as unknown as Plugin,
    resolveConfig({ compress: { retainRecentTurns: 1, minNetSavingsTokens: 1 } }),
  )

  const results: ProbeResult[] = []
  for (let index = 0; index < count; index++) {
    results.push(await probe(ctx, index))
  }
  await ctx.fiber.dispose()

  const valid = results.filter((result) => result.schemaValid).length
  const committed = results.filter((result) => result.committed).length
  const errors = results
    .filter((result) => result.errorText !== undefined)
    .map((result) => result.errorText)
  console.log(
    `real-model-probes: ${count} probes, schema-valid ${valid}/${count}, committed ${committed}/${count}`,
  )
  if (errors.length > 0) console.log(`real-model-probes errors:\n${errors.join('\n---\n')}`)
}

await main()
