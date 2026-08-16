/**
 * M6.2 real-model probes: natural / invalid-ref correction / nested compress
 * through the real dsh agent loop (opencode go / deepseek-v4-flash).
 * Reports schema-valid, committed, and prior-block preservation rates.
 * Not a CI gate; results are written to docs/real-model-probes-<scenario>.md.
 */

import { writeFile } from 'node:fs/promises'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
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
  priorBlockPreserved?: boolean
}

function user(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function summarizeProbe(events: readonly SessionEvent[]): ProbeResult {
  const compressCalls = events.filter(
    (event) => event.type === 'tool/call' && event.data.name === 'compress',
  )
  let schemaValid = false
  const call = compressCalls[0]
  if (call?.type === 'tool/call') {
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

async function probeForced(ctx: Context, index: number): Promise<ProbeResult> {
  const agent = ctx.agentLoop.create(SessionId(`probe-${index}-${Date.now()}`), {
    provider: 'go',
    model,
    maxTokens: 1000,
  })
  agent.followup(user('First turn: say hello in one line.'))
  await waitForIdle(ctx, agent)
  agent.followup(
    user(
      'Second turn: boundary markers m0001 and m0002 are visible. Use the compress tool on range m0001..m0002 with a short summary, then confirm in one line.',
    ),
  )
  await waitForIdle(ctx, agent)
  return summarizeProbe([...agent.session.events])
}

async function probeAutonomous(ctx: Context, index: number): Promise<ProbeResult> {
  const agent = ctx.agentLoop.create(SessionId(`autonomous-${index}-${Date.now()}`), {
    provider: 'go',
    model,
    maxTokens: 1000,
  })
  const paragraph =
    'We are building a context management plugin for an agent harness. ' +
    'It replaces closed conversation ranges with high-fidelity summaries, keeps protected ' +
    'tool outputs verbatim, deduplicates repeated tool calls, and exposes recovery commands. ' +
    'The boundary protocol logs markers per step so the model can reference closed ranges. ' +
    'Nested compression preserves prior block summaries in an appendix. ' +
    'Automatic strategies run before each request and remain idempotent across restarts.'
  agent.followup(
    user(`First turn: read and retain the following context for later work:\n\n${paragraph}`),
  )
  await waitForIdle(ctx, agent)
  agent.followup(
    user('Second turn: continue working on the retained context and reply briefly.'),
  )
  await waitForIdle(ctx, agent)
  return summarizeProbe([...agent.session.events])
}

async function probeCorrection(ctx: Context, index: number): Promise<ProbeResult> {
  const agent = ctx.agentLoop.create(SessionId(`correction-${index}-${Date.now()}`), {
    provider: 'go',
    model,
    maxTokens: 1000,
  })
  agent.followup(user('First turn: say hello in one line.'))
  await waitForIdle(ctx, agent)
  agent.followup(
    user('Second turn: use the compress tool on range m0001..m9999 with a short summary.'),
  )
  await waitForIdle(ctx, agent)
  agent.followup(
    user(
      'Third turn: the previous range was invalid. Retry with a valid closed range that can actually be compressed.',
    ),
  )
  await waitForIdle(ctx, agent)
  const events = [...agent.session.events]
  const result = summarizeProbe(events)
  const firstError = events.some(
    (event, index) =>
      event.type === 'tool/result' &&
      event.data.message.content[0]?.isError &&
      events
        .slice(0, index)
        .some(
          (call) =>
            call.type === 'tool/call' &&
            String(call.data.callId) === String(event.data.message.source.callId),
        ),
  )
  result.committed = result.committed && firstError
  return result
}

async function probeNested(ctx: Context, index: number): Promise<ProbeResult> {
  const agent = ctx.agentLoop.create(SessionId(`nested-${index}-${Date.now()}`), {
    provider: 'go',
    model,
    maxTokens: 1000,
  })
  agent.followup(user('First turn: describe a small project in one sentence.'))
  await waitForIdle(ctx, agent)
  agent.followup(
    user(
      'Second turn: use the compress tool on range m0001..m0002 with summary "first block".',
    ),
  )
  await waitForIdle(ctx, agent)
  agent.followup(
    user(
      'Third turn: now compress the range b1..m0003 with summary "nested over prior". Keep prior block facts.',
    ),
  )
  await waitForIdle(ctx, agent)
  const events = [...agent.session.events]
  const state = reduceDcpState(events)
  const newBlocks = state.blocks.filter((block) => block.meta.kind === 'summary')
  const nestedCommitted =
    newBlocks.length >= 2 &&
    newBlocks.at(-1)!.meta.consumedBlockRefs.includes('b1') &&
    state.activeBlockRefs.includes(newBlocks.at(-1)!.ref)
  const base = summarizeProbe(events)
  const result: ProbeResult = {
    schemaValid: base.schemaValid,
    committed: nestedCommitted,
  }
  const text = agent.session
    .deriveMessages()
    .flatMap((message) => message.content)
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
  result.priorBlockPreserved = text.includes('Included prior blocks')
  return result
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

  const scenario = process.env.DSH_DCP_PROBE_SCENARIO ?? 'forced'
  const runner =
    scenario === 'correction'
      ? probeCorrection
      : scenario === 'nested'
        ? probeNested
        : scenario === 'autonomous'
          ? probeAutonomous
          : probeForced
  const results: ProbeResult[] = []
  for (let index = 0; index < count; index++) {
    results.push(await runner(ctx, index))
  }
  await ctx.fiber.dispose()

  const valid = results.filter((result) => result.schemaValid).length
  const committed = results.filter((result) => result.committed).length
  const errors = results
    .filter((result) => result.errorText !== undefined)
    .map((result) => result.errorText)
  const prior = results.filter((result) => result.priorBlockPreserved).length
  console.log(
    `real-model-probes [${scenario}]: ${count} probes, schema-valid ${valid}/${count}, committed ${committed}/${count}` +
      (scenario === 'nested' ? `, prior-block preserved ${prior}/${count}` : ''),
  )
  if (errors.length > 0) console.log(`real-model-probes errors:\n${errors.join('\n---\n')}`)

  const lines = [
    `# Real-model probes — ${scenario} (${new Date().toISOString()})`,
    '',
    `- count: ${count}`,
    `- schema-valid: ${valid}/${count}`,
    `- committed: ${committed}/${count}`,
    ...(scenario === 'nested' ? [`- prior-block preserved: ${prior}/${count}`] : []),
    '- results:',
    ...results.map((result, index) => `  ${index + 1}. ${JSON.stringify(result)}`),
    '',
  ]
  await writeFile(`docs/real-model-probes-${scenario}.md`, lines.join('\n'), 'utf8')
}

await main()
