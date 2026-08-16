import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import { buildBoundaryMarker } from '../../src/refs/marker.js'

export function markerMessage(ref: string, turn: number, step: number) {
  return createUserMessage({
    content: [{ type: 'text', text: buildBoundaryMarker(ref, turn, step) }],
    source: { kind: 'plugin', plugin: 'dsh-dcp' },
  })
}

/** Turn 1..3 closed with markers m0001..m0003; turn 4 open with compress call. */
export function buildMarkedSession(ctx: Context): Session {
  const session = ctx.sessions.create(SessionId(`m2-${Math.random().toString(36).slice(2)}`))

  const turn = (number: number, ref: string, userText: string, withTool: boolean) => {
    session.append('turn/start', { turn: number })
    session.append('user/message', markerMessage(ref, number, 1), { surfaceOp: 'append' })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: userText }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    session.append('step/start', { turn: number, step: 1 })
    if (withTool) {
      const callId = CallId(`c${number}`)
      session.append(
        'assistant/message',
        {
          turn: number,
          step: 1,
          message: createAssistantMessage({
            content: [
              { type: 'text', text: `assistant ${number}` },
              { type: 'tool-call', id: callId, name: 'read', arguments: '{"path":"a.txt"}' },
            ],
            source: { provider: 'mock', model: 'mock' },
          }),
        },
        { surfaceOp: 'append', sourceEventSeqs: [] },
      )
      const call = session.append('tool/call', {
        turn: number,
        step: 1,
        callId,
        name: 'read',
        arguments: '{"path":"a.txt"}',
      })
      session.append(
        'tool/result',
        {
          turn: number,
          step: 1,
          message: createToolResultMessage({
            callId,
            content: [{ type: 'text', text: `result ${number}` }],
            isError: false,
          }),
        },
        { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
      )
    } else {
      session.append(
        'assistant/message',
        {
          turn: number,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: `assistant ${number}` }],
            source: { provider: 'mock', model: 'mock' },
          }),
        },
        { surfaceOp: 'append', sourceEventSeqs: [] },
      )
    }
    session.append('step/end', { turn: number, step: 1 })
    session.append('turn/end', { turn: number, reason: { kind: 'completed' } })
  }

  turn(1, 'm0001', 'first user message', false)
  turn(2, 'm0002', 'second user message', true)
  turn(3, 'm0003', 'third user message', false)

  session.append('turn/start', { turn: 4 })
  session.append('user/message', markerMessage('m0004', 4, 1), { surfaceOp: 'append' })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'fourth user message' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append('step/start', { turn: 4, step: 1 })
  const inlineArgs = JSON.stringify({
    topic: 'closed turns',
    content: [
      {
        startRef: 'm0001',
        endRef: 'm0004',
        summary: 'a very long inline summary that duplicates the checkpoint',
      },
    ],
  })
  session.append(
    'assistant/message',
    {
      turn: 4,
      step: 1,
      message: createAssistantMessage({
        content: [
          { type: 'text', text: 'compressing now' },
          {
            type: 'tool-call',
            id: CallId('dcp-call'),
            name: 'compress',
            arguments: inlineArgs,
          },
        ],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
    { surfaceOp: 'append', sourceEventSeqs: [] },
  )
  session.append('tool/call', {
    turn: 4,
    step: 1,
    callId: CallId('dcp-call'),
    name: 'compress',
    arguments: inlineArgs,
  })
  return session
}

export function closeOpenTurn(session: Session, turn: number, callId: string): void {
  session.append(
    'tool/result',
    {
      turn,
      step: 1,
      message: createToolResultMessage({
        callId: CallId(callId),
        content: [{ type: 'text', text: 'compress done' }],
        isError: false,
      }),
    },
    { surfaceOp: 'append', sourceEventSeqs: [session.seq - 1] },
  )
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}
