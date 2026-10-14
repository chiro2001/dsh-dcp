import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as agentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as compactionInvariant from '@deepseek-ai/dsh-compaction/invariant'
import {
  foldSurface,
  isReplacementSurfaceEvent,
  SessionId,
  type SessionEvent,
  type ToolResultMessage,
} from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import * as dcpPlugin from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'
import { decodeDcpMeta } from '../../src/protocol/metadata.js'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { readRealModelConfig } from '../../scripts/real-model-config.js'
import { OpenCodeGoAdapter } from './opencode-go-adapter.js'

const realModelConfig =
  process.env.DSH_DCP_REAL_MODEL === '1' ? readRealModelConfig() : undefined
const enabled = realModelConfig !== undefined

let ctx: Context | undefined
let adapter: OpenCodeGoAdapter | undefined
let tempRoot: string | undefined
const originalDshHome = process.env.DSH_HOME
const originalXdgData = process.env.XDG_DATA_HOME
const originalXdgConfig = process.env.XDG_CONFIG_HOME
const recallFact = 'Amber Kestrel'
const recallArtifact = 'canary-layout.yaml'
const firstTurnText = [
  `Synthetic release rehearsal facts for later work: deployment codename ${recallFact}; artifact ${recallArtifact}; build label rel-2026-10-14-rc12.`,
  'Constraints: verify the signed audit diff against the release manifest before any rollout; preserve the canary smoke evidence; never infer a successful deployment from a green preparation check.',
  'Recovery: if the canary smoke fails, stop the rollout, retain the failure report, and inspect the current manifest before trying again. The target is the isolated west-canary-2 test environment.',
  ...Array.from(
    { length: 8 },
    (_, index) =>
      `Routine processing note ${index + 1}: the staging worker polls its queue every thirty seconds, the temporary cache is rebuilt from the manifest, and the health dashboard reports ordinary green status. No release decision, failure, or unique artifact is recorded in this routine note.`,
  ),
  'Reply with a short acknowledgement without repeating the codename or artifact name.',
].join('\n\n')

function toolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join(' ')
}

function compressRangesFromArguments(
  argumentsText: string,
): Array<{ startRef: string; endRef: string }> {
  try {
    const parsed: unknown = JSON.parse(argumentsText)
    if (typeof parsed !== 'object' || parsed === null || !('content' in parsed)) return []
    if (!Array.isArray(parsed.content)) return []
    return parsed.content.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
      const entryStartRef = 'startRef' in entry ? entry.startRef : undefined
      const entryEndRef = 'endRef' in entry ? entry.endRef : undefined
      return typeof entryStartRef === 'string' && typeof entryEndRef === 'string'
        ? [{ startRef: entryStartRef, endRef: entryEndRef }]
        : []
    })
  } catch {
    return []
  }
}

beforeAll(async () => {
  if (realModelConfig === undefined) return
  tempRoot = await mkdtemp(join(tmpdir(), 'dsh-dcp-real-'))
  process.env.DSH_HOME = join(tempRoot, 'dsh-home')
  process.env.XDG_DATA_HOME = join(tempRoot, 'xdg-data')
  process.env.XDG_CONFIG_HOME = join(tempRoot, 'xdg-config')

  const next = new Context()
  await next.plugin(InvariantRegistry)
  await mountAgentLoopTestDependencies(next, {
    systemPrompt: {
      personaPrefix:
        'You are a DCP integration test agent. Follow instructions exactly; when asked, call the compress tool with the exact refs given.',
    },
  })
  await next.plugin(sessionInvariant as unknown as Plugin)
  await next.plugin(agentLoopInvariant as unknown as Plugin)
  await next.plugin(compactionInvariant as unknown as Plugin)
  await next.plugin(TokenMeter)
  await next.plugin(CommandRuntime)
  await next.plugin(AgentLoop, { agents: [] })
  adapter = new OpenCodeGoAdapter({
    baseUrl: realModelConfig.baseUrl,
    apiKey: realModelConfig.apiKey,
    thinking: realModelConfig.thinking,
  })
  next.llm.registerAdapter([realModelConfig.provider], adapter)
  await next.plugin(dcpPlugin as unknown as Plugin, resolveConfig({}))
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

function boundaryRefForTurn(events: readonly SessionEvent[], turn: number): string | undefined {
  for (const event of events) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'dsh-dcp') continue
    for (const block of event.data.content) {
      if (block.type !== 'text') continue
      const marker = new RegExp(
        `<dcp-boundary ref="(m\\d+)" turn="${turn}" step="\\d+" />`,
      ).exec(block.text)
      if (marker?.[1] !== undefined) return marker[1]
    }
  }
  return undefined
}

describe.skipIf(!enabled)('real agent + configured real model (isolated env)', () => {
  it('drives the compress tool through the real agent loop and verifies the surface', async () => {
    if (!ctx || realModelConfig === undefined) throw new Error('harness not mounted')
    const agent = await ctx.agentLoop.create(SessionId('real-dcp'), {
      provider: realModelConfig.provider,
      model: realModelConfig.model,
      maxTokens: 1000,
    })
    const globalCompress = ctx.tools.get('compress')
    const agentCompress = agent.ctx.tools.get('compress')
    expect(globalCompress?.name).toBe('compress')
    expect(agentCompress?.name).toBe('compress')

    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: firstTurnText }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    const firstTurnEvents = agent.session.snapshotEvents()
    const firstTurnStartRef = boundaryRefForTurn(firstTurnEvents, 1)
    const firstUserEvent = firstTurnEvents.find(
      (event) =>
        event.type === 'user/message' &&
        event.data.source.kind === 'user' &&
        event.data.content.some(
          (block) => block.type === 'text' && block.text === firstTurnText,
        ),
    )
    expect(firstUserEvent).toBeDefined()
    if (firstTurnStartRef === undefined) throw new Error('first-turn boundary ref missing')

    agent.followup(
      createUserMessage({
        content: [
          {
            type: 'text',
            text: 'Filler turn: acknowledge that the release rehearsal is ready. Add no release facts or artifact names.',
          },
        ],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    const fillerEvents = agent.session.snapshotEvents()
    const firstTurnEndRef = boundaryRefForTurn(fillerEvents, 2)
    if (firstTurnEndRef === undefined) throw new Error('filler-turn boundary ref missing')
    expect(firstTurnEndRef).not.toBe(firstTurnStartRef)

    const thirdTurnPrompt = `Third turn: call the compress tool on closed range startRef "${firstTurnStartRef}", endRef "${firstTurnEndRef}", topic "release rehearsal". Write your own concise faithful summary of the selected history, preserving its key facts, constraints, and artifact names. For this response, emit only one native compress tool call with no prose. After the tool result, reply READY without repeating facts.`
    expect(thirdTurnPrompt).not.toContain(recallFact)
    expect(thirdTurnPrompt).not.toContain(recallArtifact)

    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: thirdTurnPrompt }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)

    let events = agent.session.snapshotEvents()
    const compressCalls = events.filter(
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
    const requestDiagnostics = adapter?.requestDiagnostics ?? []
    const responseDiagnostics = adapter?.responseDiagnostics ?? []
    expect(requestDiagnostics.length).toBeGreaterThan(0)
    expect(requestDiagnostics.every((request) => request.hasCompressSchema)).toBe(true)
    expect(requestDiagnostics.every((request) => request.model === realModelConfig.model)).toBe(
      true,
    )
    expect(requestDiagnostics.every((request) => request.thinking === 'disabled')).toBe(true)
    expect(responseDiagnostics).toHaveLength(requestDiagnostics.length)
    expect(
      responseDiagnostics.every((response) => response.httpStatus === 200),
      JSON.stringify({ requests: requestDiagnostics, responses: responseDiagnostics }),
    ).toBe(true)
    expect(responseDiagnostics.every((response) => response.finishReason !== undefined)).toBe(
      true,
    )
    const nativeCompressResponse = responseDiagnostics.find((response) =>
      response.channelToolNames.includes('compress'),
    )
    expect(nativeCompressResponse).toBeDefined()
    expect(nativeCompressResponse?.xmlToolNames).not.toContain('compress')
    expect(nativeCompressResponse?.reasoningLength).toBe(0)
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
          `${event.data.message.isError ? '[ERROR] ' : ''}${toolResultText(event.data.message)}`,
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
    expect(decodedCheckpoint.meta.startRef).toBe(firstTurnStartRef)
    expect(decodedCheckpoint.meta.endRef).toBe(firstTurnEndRef)
    expect(checkpoint.sourceEventSeqs).toContain(firstUserEvent.seq)
    const checkpointText = checkpoint.data.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(checkpointText).toContain(recallFact)
    expect(checkpointText).toContain(recallArtifact)
    expect(isReplacementSurfaceEvent(checkpoint)).toBe(true)
    if (!isReplacementSurfaceEvent(checkpoint)) {
      throw new Error('checkpoint is not a surface replacement')
    }
    const surfaceBeforeReplacement = foldSurface(events.slice(0, summaryIndex + 1)).nodes
    const targetPosition = surfaceBeforeReplacement.indexOf(firstUserEvent.seq)
    const startPosition = surfaceBeforeReplacement.indexOf(checkpoint.surfaceOp.startSeq)
    const endPosition = surfaceBeforeReplacement.indexOf(checkpoint.surfaceOp.endSeq)
    expect(targetPosition).toBeGreaterThanOrEqual(startPosition)
    expect(targetPosition).toBeLessThanOrEqual(endPosition)
    expect(agent.session.surface.nodes).toContain(checkpoint.seq)
    expect(agent.session.surface.nodes).not.toContain(firstUserEvent.seq)
    expect(state.blocks.some((block) => block.seq === checkpoint.seq)).toBe(true)
    expect(state.activeBlockRefs).toContain(decodedCheckpoint.meta.blockRef)

    const committedCall = events.find(
      (event) =>
        event.type === 'tool/call' &&
        String(event.data.callId) === decodedCheckpoint.meta.compressCallId,
    )
    const committedAuthor = events.find(
      (event) =>
        event.type === 'assistant/message' &&
        event.data.message.content.some(
          (block) =>
            block.type === 'tool-call' &&
            String(block.id) === decodedCheckpoint.meta.compressCallId,
        ),
    )
    const committedResult = events.find(
      (event) =>
        event.type === 'tool/result' &&
        String(event.data.message.source.callId) === decodedCheckpoint.meta.compressCallId,
    )
    expect(committedCall?.type).toBe('tool/call')
    expect(committedAuthor?.type).toBe('assistant/message')
    expect(committedResult?.type).toBe('tool/result')
    if (
      committedCall?.type !== 'tool/call' ||
      committedAuthor?.type !== 'assistant/message' ||
      committedResult?.type !== 'tool/result'
    ) {
      throw new Error('committed compress call/result pair missing')
    }
    const committedArguments = JSON.parse(committedCall.data.arguments) as {
      content?: Array<{ startRef?: string; endRef?: string; summary?: string }>
    }
    const submittedSummary = committedArguments.content?.find(
      (entry) => entry.startRef === firstTurnStartRef && entry.endRef === firstTurnEndRef,
    )?.summary
    expect(submittedSummary).toBeDefined()
    if (submittedSummary === undefined) throw new Error('model omitted the submitted summary')
    expect(submittedSummary).toContain(recallFact)
    expect(submittedSummary).toContain(recallArtifact)
    expect(submittedSummary).toContain('signed audit diff')
    expect(submittedSummary.length).toBeLessThan(firstTurnText.length / 2)
    expect(committedAuthor.data.message.content.map((block) => block.type)).toEqual([
      'tool-call',
    ])
    const cleanupMessage = events.find(
      (event) =>
        event.type === 'user/message' &&
        event.data.source.kind === 'dsh-dcp' &&
        event.data.content.some(
          (block) =>
            block.type === 'text' &&
            block.text.includes('<dcp-cleanup') &&
            block.text.includes('status="success"') &&
            block.text.includes(`callId: ${decodedCheckpoint.meta.compressCallId}`) &&
            block.text.includes(`archived in ${decodedCheckpoint.meta.blockRef}`) &&
            block.text.includes(
              `archived_result: status=success; committed=${decodedCheckpoint.meta.blockRef}; rejected=none; correction=STOP`,
            ),
        ),
    )
    expect(cleanupMessage?.type).toBe('user/message')
    if (cleanupMessage?.type !== 'user/message') {
      throw new Error('successful compress step lacks its cleanup replacement')
    }
    expect(isReplacementSurfaceEvent(cleanupMessage)).toBe(true)
    if (!isReplacementSurfaceEvent(cleanupMessage)) {
      throw new Error('successful cleanup did not replace the compress step on the surface')
    }
    expect(cleanupMessage.sourceEventSeqs).toContain(committedAuthor.seq)
    expect(cleanupMessage.sourceEventSeqs).toContain(committedResult.seq)
    const cleanupText = cleanupMessage.data.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(cleanupText).toContain('Continue the task; do not retry committed ranges.')

    const resultDispatch = requestDiagnostics.find((request) =>
      request.toolResultCallIds.includes(decodedCheckpoint.meta.compressCallId),
    )
    expect(resultDispatch).toBeDefined()
    expect(resultDispatch?.hasDcpCleanupMessage).toBe(false)
    const readyReply = events.find(
      (event) =>
        event.type === 'assistant/message' &&
        event.data.turn === committedResult.data.turn &&
        event.data.step === committedResult.data.step + 1,
    )
    expect(readyReply?.type).toBe('assistant/message')
    if (readyReply?.type !== 'assistant/message') {
      throw new Error('the post-tool model response did not settle the turn')
    }
    const readyText = readyReply.data.message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join(' ')
    expect(readyText).toMatch(/\bREADY\b/i)
    expect(readyText).not.toContain(recallFact)
    expect(readyText).not.toContain(recallArtifact)
    expect(cleanupMessage.seq).toBeGreaterThan(readyReply.seq)

    const visibleAfterCleanup = agent.session.deriveMessages()
    const factBearingMessages = visibleAfterCleanup.filter((message) =>
      message.content.some(
        (block) =>
          block.type === 'text' &&
          (block.text.includes(recallFact) || block.text.includes(recallArtifact)),
      ),
    )
    expect(factBearingMessages.map((message) => message.id)).toEqual([checkpoint.data.id])
    expect(
      visibleAfterCleanup.some(
        (message) =>
          message.role === 'user' &&
          message.source.kind === 'user' &&
          message.content.some(
            (block) => block.type === 'text' && block.text === firstTurnText,
          ),
      ),
    ).toBe(false)
    expect(
      visibleAfterCleanup.some(
        (message) =>
          message.role === 'assistant' &&
          message.content.some(
            (block) =>
              block.type === 'tool-call' &&
              String(block.id) === decodedCheckpoint.meta.compressCallId,
          ),
      ),
    ).toBe(false)
    expect(
      visibleAfterCleanup.some(
        (message) =>
          message.role === 'tool' &&
          String(message.source.callId) === decodedCheckpoint.meta.compressCallId,
      ),
    ).toBe(false)
    expect(JSON.stringify(visibleAfterCleanup)).toContain(
      `archived_result: status=success; committed=${decodedCheckpoint.meta.blockRef}; rejected=none; correction=STOP`,
    )

    const recallPrompt =
      'What were the deployment codename and manifest artifact name from the release rehearsal?'
    expect(recallPrompt).not.toContain(recallFact)
    expect(recallPrompt).not.toContain(recallArtifact)
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: recallPrompt }],
        source: { kind: 'user' },
      }),
    )
    await waitForIdle(agent)
    events = agent.session.snapshotEvents()

    const cleanupRequest = requestDiagnostics.find((request) => request.hasDcpCleanupMessage)
    expect(cleanupRequest).toBeDefined()
    expect(cleanupRequest?.toolResultCallIds).not.toContain(
      decodedCheckpoint.meta.compressCallId,
    )
    expect(
      cleanupRequest?.compressRanges.some(
        (range) =>
          range.startRef === decodedCheckpoint.meta.startRef &&
          range.endRef === decodedCheckpoint.meta.endRef,
      ),
    ).toBe(false)
    expect(responseDiagnostics).toHaveLength(requestDiagnostics.length)
    expect(
      responseDiagnostics.every((response) => response.httpStatus === 200),
      JSON.stringify({ requests: requestDiagnostics, responses: responseDiagnostics }),
    ).toBe(true)
    const cleanupIndex = events.findIndex((event) => event.seq === cleanupMessage.seq)
    const committedRangeCalls = events.flatMap((event) => {
      if (event.type !== 'assistant/message') return []
      return event.data.message.content.flatMap((block) => {
        if (block.type !== 'tool-call' || block.name !== 'compress') return []
        const ranges = compressRangesFromArguments(block.arguments)
        return ranges.some(
          (range) =>
            range.startRef === decodedCheckpoint.meta.startRef &&
            range.endRef === decodedCheckpoint.meta.endRef,
        )
          ? [{ callId: String(block.id), turn: event.data.turn, step: event.data.step }]
          : []
      })
    })
    const repeatedCalls = committedRangeCalls.filter(
      (call) => call.callId !== decodedCheckpoint.meta.compressCallId,
    )
    const retryResults = repeatedCalls.map((call) => {
      const result = events.find(
        (event) =>
          event.type === 'tool/result' &&
          String(event.data.message.source.callId) === call.callId,
      )
      const resultText =
        result?.type === 'tool/result' ? toolResultText(result.data.message) : ''
      return {
        ...call,
        resultStatus: /status=([a-z]+)/.exec(resultText)?.[1],
        resultCodes: [...resultText.matchAll(/\[([A-Z_]+)\]/g)].map((match) => match[1]),
        resultText: resultText.slice(0, 300),
      }
    })
    expect(
      committedRangeCalls.map((call) => call.callId),
      JSON.stringify({
        committedCallId: decodedCheckpoint.meta.compressCallId,
        committedRange: [decodedCheckpoint.meta.startRef, decodedCheckpoint.meta.endRef],
        cleanupRequestRanges: cleanupRequest?.compressRanges,
        resultDispatch,
        retryResults,
      }),
    ).toEqual([decodedCheckpoint.meta.compressCallId])
    const answerAfterCleanup = events
      .slice(cleanupIndex + 1)
      .flatMap((event) =>
        event.type === 'assistant/message' && event.data.turn === 4
          ? event.data.message.content
              .filter((block) => block.type === 'text')
              .map((block) => (block.type === 'text' ? block.text : ''))
          : [],
      )
      .join(' ')
    expect(answerAfterCleanup).toContain(recallFact)
    expect(answerAfterCleanup).toContain(recallArtifact)

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
      const resultText = toolResultText(event.data.message)
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
      const cleanupTexts = events.flatMap((event) => {
        if (event.type !== 'user/message') return []
        return event.data.content
          .filter((block) => block.type === 'text')
          .map((block) => (block.type === 'text' ? block.text : ''))
      })
      for (const callId of rejectedCallIds) {
        const cleaned = cleanupTexts.some(
          (text) => text.includes('<dcp-cleanup') && text.includes(`callId: ${callId}`),
        )
        if (cleaned) continue
        // Cleanup is deferred to the next pre-step.  If this rejection belongs
        // to the final step, the raw call must still be present for audit.
        expect(
          events.some(
            (event) =>
              event.type === 'assistant/message' &&
              event.data.message.content.some(
                (block) => block.type === 'tool-call' && String(block.id) === callId,
              ),
          ),
        ).toBe(true)
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

    const usageTotals = responseDiagnostics.reduce(
      (total, response) => ({
        uncachedInputTokens: total.uncachedInputTokens + (response.usage?.inputTokens ?? 0),
        cacheReadTokens: total.cacheReadTokens + (response.usage?.cacheReadTokens ?? 0),
        outputTokens: total.outputTokens + (response.usage?.outputTokens ?? 0),
        reasoningTokens: total.reasoningTokens + (response.usage?.reasoningTokens ?? 0),
      }),
      { uncachedInputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    )
    console.info(
      'REAL_MODEL_METRICS ' +
        JSON.stringify({
          provider: realModelConfig.provider,
          model: realModelConfig.model,
          requestCount: requestDiagnostics.length,
          usage: {
            promptTokens: usageTotals.uncachedInputTokens + usageTotals.cacheReadTokens,
            ...usageTotals,
          },
          committedBlock: decodedCheckpoint.meta.blockRef,
          committedRange: [decodedCheckpoint.meta.startRef, decodedCheckpoint.meta.endRef],
          cleanupApplied: true,
          recalledCodename: answerAfterCleanup.includes(recallFact),
          recalledArtifact: answerAfterCleanup.includes(recallArtifact),
        }),
    )
  }, 240_000)
})
