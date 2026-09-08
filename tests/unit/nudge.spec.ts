import { describe, expect, it } from 'vitest'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm/message'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import { resolveConfig } from '../../src/config.js'
import { computeNudge } from '../../src/prompts/nudge.js'
import { buildBoundaryMarker } from '../../src/refs/marker.js'
import { encodeDcpCheckpointSource } from '../../src/protocol/metadata.js'

function sessionWithMarkers(count: number, withContext = true): Session {
  const session = Session.create(SessionId('nudge-test'))
  for (let index = 1; index <= count; index++) {
    session.append('turn/start', { turn: index })
    session.append(
      'user/message',
      createUserMessage({
        content: [
          {
            type: 'text',
            text: buildBoundaryMarker(`m${String(index).padStart(4, '0')}`, index, 1),
          },
        ],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
      { surfaceOp: 'append' },
    )
    session.append('step/start', { turn: index, step: 1 })
    session.append(
      'assistant/message',
      {
        turn: index,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: `reply ${index}` }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('step/end', { turn: index, step: 1 })
    session.append('turn/end', { turn: index, reason: { kind: 'completed' } })
  }
  if (withContext) {
    session.append('request/context', { provider: 'mock', model: 'mock', contextWindow: 1000 })
  }
  return session
}

function fakeMeasure(totalTokens: number): TokenMeasurement {
  return {
    totalTokens,
    logRevision: SessionLogOffset(0),
    baseline: { kind: 'none', tokens: 0 },
    surfaceDeltaTokens: 0,
    surfaceTokens: 0,
    nodes: [],
  } as TokenMeasurement
}

describe('nudge (M3)', () => {
  it('emits only after frequency steps above max ratio, with hysteresis', () => {
    const config = resolveConfig({})
    const few = computeNudge(sessionWithMarkers(2), fakeMeasure(900), config)
    expect(few.text).toBeUndefined()
    expect(few.stepsSinceNudge).toBe(2)

    const many = computeNudge(sessionWithMarkers(9), fakeMeasure(900), config)
    expect(many.text).toContain('compression recommended')
    expect(many.stepsSinceNudge).toBe(9)

    const lowPressure = computeNudge(sessionWithMarkers(9), fakeMeasure(500), config)
    expect(lowPressure.text).toBeUndefined()
    expect(lowPressure.stepsSinceNudge).toBe(0)

    const noWindow = computeNudge(sessionWithMarkers(13, false), fakeMeasure(0), config)
    expect(noWindow.text).toContain('without pressure data')
  })

  it('does not re-arm after a rejected compress following an earlier checkpoint', () => {
    const session = sessionWithMarkers(9)
    session.append(
      'user/message',
      createUserMessage({
        content: [
          {
            type: 'text',
            text:
              `${buildBoundaryMarker('m0010', 10, 1)}\n` +
              'DCP compression recommended: context is above the model window.',
          },
        ],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
      { surfaceOp: 'append' },
    )
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'checkpoint' }],
        source: encodeDcpCheckpointSource(CompactionId('nudge-checkpoint'), {
          v: 1,
          kind: 'summary',
          blockRef: 'b1',
          mode: 'range',
          topic: 't',
          startRef: 'm0001',
          endRef: 'm0002',
          authorMessageId: 'a',
          compressCallId: 'c',
          consumedBlockRefs: [],
          protectedKinds: [],
        }),
      }),
      { surfaceOp: 'append' },
    )
    const compressCall = session.append('tool/call', {
      turn: 10,
      step: 1,
      callId: ToolCallId('rejected-compress'),
      name: 'compress',
      arguments: '{}',
    })
    session.append(
      'tool/result',
      {
        turn: 10,
        step: 1,
        message: createToolResultMessage({
          callId: ToolCallId('rejected-compress'),
          content: [{ type: 'text', text: 'status=rejected' }],
          // The range pipeline can return a rejected status as a successful
          // tool value after all per-range attempts fail; nudge state must
          // recognize both this form and ordinary tool errors.
          isError: false,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [compressCall.seq] },
    )
    for (let marker = 11; marker <= 18; marker++) {
      session.append(
        'user/message',
        createUserMessage({
          content: [
            {
              type: 'text',
              text: buildBoundaryMarker(`m${String(marker).padStart(4, '0')}`, marker, 1),
            },
          ],
          source: { kind: 'plugin', plugin: 'dsh-dcp' },
        }),
        { surfaceOp: 'append' },
      )
    }

    const rejectedResult = computeNudge(session, fakeMeasure(900), resolveConfig({}))
    expect(rejectedResult.text).toBeUndefined()
    expect(rejectedResult.armed).toBe(false)

    const policyBlockedCall = session.append('tool/call', {
      turn: 10,
      step: 2,
      callId: ToolCallId('policy-blocked-compress'),
      name: 'compress',
      arguments: '{}',
    })
    session.append(
      'tool/result',
      {
        turn: 10,
        step: 2,
        message: createToolResultMessage({
          callId: ToolCallId('policy-blocked-compress'),
          // b1 is the durable checkpoint appended above; this synthetic
          // partial result models a downstream policy error after that commit.
          content: [{ type: 'text', text: 'status=partial; committed=b1; rejected=none' }],
          // A downstream policy can mark an already-committed result as an
          // error. The explicit committed status must take precedence.
          isError: true,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [policyBlockedCall.seq] },
    )
    for (let marker = 19; marker <= 26; marker++) {
      session.append(
        'user/message',
        createUserMessage({
          content: [
            {
              type: 'text',
              text: buildBoundaryMarker(`m${String(marker).padStart(4, '0')}`, marker, 1),
            },
          ],
          source: { kind: 'plugin', plugin: 'dsh-dcp' },
        }),
        { surfaceOp: 'append' },
      )
    }
    const policyResult = computeNudge(session, fakeMeasure(900), resolveConfig({}))
    expect(policyResult.text).toContain('compression recommended')
    expect(policyResult.armed).toBe(true)

    const successfulCall = session.append('tool/call', {
      turn: 10,
      step: 3,
      callId: ToolCallId('successful-compress'),
      name: 'compress',
      arguments: '{}',
    })
    session.append(
      'tool/result',
      {
        turn: 10,
        step: 3,
        message: createToolResultMessage({
          callId: ToolCallId('successful-compress'),
          content: [{ type: 'text', text: 'status=success; committed=b3; rejected=none' }],
          isError: false,
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [successfulCall.seq] },
    )
    for (let marker = 27; marker <= 34; marker++) {
      session.append(
        'user/message',
        createUserMessage({
          content: [
            {
              type: 'text',
              text: buildBoundaryMarker(`m${String(marker).padStart(4, '0')}`, marker, 1),
            },
          ],
          source: { kind: 'plugin', plugin: 'dsh-dcp' },
        }),
        { surfaceOp: 'append' },
      )
    }
    const result = computeNudge(session, fakeMeasure(900), resolveConfig({}))
    expect(result.text).toContain('compression recommended')
    expect(result.armed).toBe(true)
  })
})
