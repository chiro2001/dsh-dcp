import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { foldSurface, isReplacementSurfaceEvent, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import * as dcpPlugin from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'
import { decodeDcpMeta } from '../../src/protocol/metadata.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { OpenCodeGoAdapter } from './opencode-go-adapter.js'

const enabled =
  process.env.DSH_DCP_REAL_MODEL === '1' && Boolean(process.env.OPENCODE_GO_API_KEY)

let ctx: Context | undefined
let adapter: OpenCodeGoAdapter | undefined
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
  await next.plugin(SessionProjectionRegistry)
  await next.plugin(TokenMeter)
  await next.plugin(CommandRuntime)
  await next.plugin(AgentLoop, { agents: [] })
  adapter = new OpenCodeGoAdapter({
    baseUrl: process.env.DSH_DCP_LLM_BASE_URL ?? 'https://opencode.ai/zen/go/v1',
    apiKey: process.env.OPENCODE_GO_API_KEY!,
    model: process.env.DSH_DCP_LLM_MODEL ?? 'deepseek-v4-flash',
  })
  next.llm.registerAdapter(['go'], adapter)
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
  adapter = undefined
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

    const firstTurnEvents = agent.session.snapshotEvents()
    const firstUserEvent = firstTurnEvents.find(
      (event) =>
        event.type === 'user/message' &&
        event.data.source.kind === 'user' &&
        event.data.content.some(
          (block) =>
            block.type === 'text' &&
            block.text === 'First turn: introduce this project in one sentence.',
        ),
    )
    expect(firstUserEvent).toBeDefined()

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

    let events = agent.session.snapshotEvents()
    let compressCalls = events.filter(
      (event) => event.type === 'tool/call' && event.data.name === 'compress',
    )
    const assistantText = () =>
      agent.session
        .snapshotEvents()
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
      '<parameter name="topic">first turn</parameter>' +
      '<parameter name="content">' +
      '<item>' +
      '<parameter name="startRef">m0001</parameter>' +
      '<parameter name="endRef">m0002</parameter>' +
      '<parameter name="summary">compressed first turn</parameter>' +
      '</item>' +
      '</parameter>' +
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
      events = agent.session.snapshotEvents()
      compressCalls = events.filter(
        (event) => event.type === 'tool/call' && event.data.name === 'compress',
      )
    }
    const requestDiagnostics = adapter?.requestDiagnostics ?? []
    const responseDiagnostics = adapter?.responseDiagnostics ?? []
    expect(requestDiagnostics.length).toBeGreaterThan(0)
    expect(requestDiagnostics.every((request) => request.hasCompressSchema)).toBe(true)
    expect(responseDiagnostics).toHaveLength(requestDiagnostics.length)
    expect(responseDiagnostics.every((response) => response.httpStatus === 200)).toBe(true)
    expect(responseDiagnostics.every((response) => response.finishReason !== undefined)).toBe(
      true,
    )
    expect(
      responseDiagnostics.some(
        (response) =>
          response.xmlToolNames.includes('compress') ||
          response.channelToolNames.includes('compress'),
      ),
    ).toBe(true)
    const diagnostics = {
      requests: requestDiagnostics,
      responses: responseDiagnostics,
      assistantText: assistantText(),
    }
    expect(compressCalls.length, JSON.stringify(diagnostics)).toBeGreaterThan(0)

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

    // The original user text may be quoted by a later assistant response.  The
    // stable compression oracle is event-level: the original surface node must
    // be listed in a DCP compaction summary's shadowedSeqs, and the replacement
    // checkpoint must remain on the current surface.
    if (firstUserEvent === undefined) throw new Error('first-turn user event missing')
    const shadowingSummary = events.find(
      (event) =>
        event.type === 'compaction/summary' &&
        event.data.shadowedSeqs.includes(firstUserEvent.seq),
    )
    expect(shadowingSummary).toBeDefined()
    if (shadowingSummary?.type !== 'compaction/summary') {
      throw new Error('first-turn user node was not shadowed by a compaction summary')
    }
    const summaryIndex = events.indexOf(shadowingSummary)
    const checkpoint = events[summaryIndex + 1]
    expect(checkpoint?.type).toBe('user/message')
    if (checkpoint?.type !== 'user/message') {
      throw new Error('compaction summary was not followed by its checkpoint replacement')
    }
    const decodedCheckpoint = decodeDcpMeta(checkpoint.data.source)
    expect(decodedCheckpoint.ok).toBe(true)
    if (!decodedCheckpoint.ok) throw new Error('checkpoint lacks DCP summary metadata')
    expect(decodedCheckpoint.meta.kind).toBe('summary')
    expect(checkpoint.sourceEventSeqs).toContain(firstUserEvent.seq)
    expect(isReplacementSurfaceEvent(checkpoint)).toBe(true)
    if (!isReplacementSurfaceEvent(checkpoint)) {
      throw new Error('checkpoint is not a surface replacement')
    }
    const surfaceBeforeReplacement = foldSurface(events.slice(0, summaryIndex + 1)).nodes
    const targetPosition = surfaceBeforeReplacement.indexOf(firstUserEvent.seq)
    const startPosition = surfaceBeforeReplacement.indexOf(checkpoint.surfaceOp.start)
    const endPosition = surfaceBeforeReplacement.indexOf(checkpoint.surfaceOp.end)
    expect(targetPosition).toBeGreaterThanOrEqual(startPosition)
    expect(targetPosition).toBeLessThanOrEqual(endPosition)
    expect(agent.session.surface.nodes).toContain(checkpoint.seq)
    expect(agent.session.surface.nodes).not.toContain(firstUserEvent.seq)
    expect(state.blocks.some((block) => block.seq === checkpoint.seq)).toBe(true)
    expect(state.activeBlockRefs).toContain(decodedCheckpoint.meta.blockRef)

    const successfulResults = toolResults.filter((text) => text.includes('status=success'))
    expect(successfulResults.length).toBeGreaterThan(0)
    expect(successfulResults.some((text) => text.includes('correction=STOP'))).toBe(true)

    // Rejected attempts are model-dependent.  Whenever one occurs, assert the
    // durable semantic guarantee: its long inline summary is replaced on the
    // derived surface by a rejected provenance marker, while the raw log keeps
    // the original call for audit.  Do not assert how many corrections the
    // model needed or what prose it generated.
    const rejectedAttemptDiagnostics = events.flatMap((event, eventIndex) => {
      if (event.type !== 'tool/result') return []
      const resultText = event.data.message.content[0]?.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join(' ')
      if (!resultText.includes('status=rejected')) return []
      const marker = events
        .slice(0, eventIndex)
        .findLast(
          (candidate) =>
            candidate.type === 'user/message' &&
            candidate.data.content.some(
              (block) =>
                block.type === 'text' &&
                block.text.includes('<dcp-boundary') &&
                block.text.includes(`turn="${event.data.turn}"`) &&
                block.text.includes(`step="${event.data.step}"`),
            ),
        )
      const markerText =
        marker?.type === 'user/message'
          ? marker.data.content
              .filter((block) => block.type === 'text')
              .map((block) => (block.type === 'text' ? block.text : ''))
              .join(' ')
          : ''
      return [
        {
          callId: String(event.data.message.source.callId),
          turn: event.data.turn,
          step: event.data.step,
          code: /rejected=[^;]*\[([A-Z_]+)\]/.exec(resultText)?.[1] ?? 'UNKNOWN',
          nudge: markerText.includes('DCP compression recommended'),
        },
      ]
    })
    if (process.env.DSH_DCP_REAL_DIAGNOSTICS === '1') {
      const rejectedByCode = Object.fromEntries(
        Object.entries(
          rejectedAttemptDiagnostics.reduce<Record<string, number>>((counts, attempt) => {
            counts[attempt.code] = (counts[attempt.code] ?? 0) + 1
            return counts
          }, {}),
        ).sort(([left], [right]) => left.localeCompare(right)),
      )
      const nudges = events.flatMap((event) => {
        if (event.type !== 'user/message') return []
        const text = event.data.content
          .filter((block) => block.type === 'text')
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join(' ')
        return text.includes('<dcp-boundary') && text.includes('DCP compression recommended')
          ? [text.match(/<dcp-boundary ref="(m\d+)" turn="(\d+)" step="(\d+)"/)?.slice(1)]
          : []
      })
      console.info(
        '[dcp-real-diagnostics] ' +
          JSON.stringify({
            compressCalls: compressCalls.length,
            rejected: rejectedAttemptDiagnostics.length,
            rejectedByCode,
            rejectedAt: rejectedAttemptDiagnostics.map(
              ({ callId, turn, step, code, nudge }) => ({
                callId,
                turn,
                step,
                code,
                nudge,
              }),
            ),
            nudgeMarkers: nudges,
            firstTurnCompressCalls: events.filter(
              (event) =>
                event.type === 'tool/call' &&
                event.data.name === 'compress' &&
                event.data.turn === 1,
            ).length,
          }),
      )
    }
    expect(
      rejectedAttemptDiagnostics.length,
      JSON.stringify({ rejectedAttempts: rejectedAttemptDiagnostics, toolResults }),
    ).toBeLessThanOrEqual(3)
    const rejectedCallIds = [
      ...new Set(rejectedAttemptDiagnostics.map((attempt) => attempt.callId)),
    ]
    if (rejectedCallIds.length > 0) {
      const derivedRejectedCalls = agent.session
        .deriveMessages()
        .flatMap((message) => message.content)
        .filter(
          (block) =>
            block.type === 'tool-call' &&
            block.name === 'compress' &&
            rejectedCallIds.includes(String(block.id)),
        )

      // A rejected assistant node may itself be shadowed by a later successful
      // checkpoint.  In that case it need not remain in the current derived
      // surface, but its raw replacement must still carry the rejection marker.
      const rawRejectedMarkers = events.flatMap((event) => {
        if (event.type !== 'assistant/message') return []
        return event.data.message.content.flatMap((block) => {
          if (block.type !== 'tool-call' || !rejectedCallIds.includes(String(block.id)))
            return []
          try {
            const parsed = JSON.parse(block.arguments) as {
              content?: Array<{ summary?: unknown }>
            }
            return (parsed.content ?? []).some(
              (entry) =>
                typeof entry.summary === 'string' &&
                entry.summary.startsWith('<dcp-inline-cleanup') &&
                entry.summary.includes('status="rejected"'),
            )
              ? [String(block.id)]
              : []
          } catch {
            return []
          }
        })
      })
      expect(rawRejectedMarkers.length).toBeGreaterThan(0)

      for (const callId of rejectedCallIds) {
        const rawSummaries = events.flatMap((event) => {
          if (event.type !== 'assistant/message') return []
          return event.data.message.content.flatMap((block) => {
            if (block.type !== 'tool-call' || String(block.id) !== callId) return []
            try {
              const parsed = JSON.parse(block.arguments) as {
                content?: Array<{ summary?: unknown }>
              }
              return (parsed.content ?? []).flatMap((entry) =>
                typeof entry.summary === 'string' &&
                !entry.summary.trimStart().startsWith('<dcp-inline-cleanup')
                  ? [entry.summary]
                  : [],
              )
            } catch {
              return []
            }
          })
        })
        const derivedCall = derivedRejectedCalls.find(
          (block) => block.type === 'tool-call' && String(block.id) === callId,
        )
        // This call was already consumed by a later checkpoint; its raw
        // marker assertion above is the relevant model-visible guarantee.
        if (derivedCall === undefined) continue
        if (derivedCall.type !== 'tool-call') throw new Error('rejected compress call missing')
        const derivedArguments = JSON.parse(derivedCall.arguments) as {
          content?: Array<{ summary?: unknown }>
        }
        const derivedSummaries = (derivedArguments.content ?? []).flatMap((entry) =>
          typeof entry.summary === 'string' ? [entry.summary] : [],
        )
        expect(
          derivedSummaries.some(
            (summary) =>
              summary.startsWith('<dcp-inline-cleanup') &&
              summary.includes('status="rejected"'),
          ),
        ).toBe(true)
        if (rawSummaries.length > 0) {
          const longestRawSummary = rawSummaries.reduce((longest, summary) =>
            summary.length > longest.length ? summary : longest,
          )
          expect(derivedCall.arguments).not.toContain(longestRawSummary)
        }
      }
    }

    // Commands run against the real agent session.
    const contextResult = await ctx.commands.execute(
      agent,
      '/dcp context',
      [],
      new AbortController().signal,
    )
    expect(contextResult?.result.kind).toBe('success')
    const manualResult = await ctx.commands.execute(
      agent,
      '/dcp manual on',
      [],
      new AbortController().signal,
    )
    expect(manualResult?.result.kind).toBe('success')
    expect(reduceDcpState(agent.session.snapshotEvents()).manualMode).toBe(true)
  }, 240_000)
})
