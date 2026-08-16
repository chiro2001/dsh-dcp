import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import { resolveConfig } from '../../src/config.js'
import { computeNudge } from '../../src/prompts/nudge.js'
import { buildBoundaryMarker } from '../../src/refs/marker.js'

function sessionWithMarkers(count: number): Session {
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
  session.append('request/context', { provider: 'mock', model: 'mock', contextWindow: 1000 })
  return session
}

function fakeMeasure(totalTokens: number): TokenMeasurement {
  return {
    totalTokens,
    logRevision: 0,
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
  })
})
