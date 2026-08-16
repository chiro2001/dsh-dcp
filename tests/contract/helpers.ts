import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'

export interface HistorySeqs {
  u1: number
  a1: number
  u2: number
  a2: number
  call: number
  result: number
}

export interface BuiltHistory {
  session: Session
  seqs: HistorySeqs
}

/**
 * Build a legal two-turn session:
 *   turn1: user u1 -> assistant a1 (text)
 *   turn2: user u2 -> assistant a2 (text) -> tool call -> tool result
 * Turn 2 is closed. Surface nodes: u1, a1, u2, a2, result.
 */
export function buildHistorySession(ctx: Context): BuiltHistory {
  const session = ctx.sessions.create(
    SessionId(`contract-${Math.random().toString(36).slice(2)}`),
  )

  session.append('turn/start', { turn: 1 })
  const u1 = session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'first user message' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append('step/start', { turn: 1, step: 1 })
  const a1 = session.append(
    'assistant/message',
    {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'first assistant message' }],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
    { surfaceOp: 'append', sourceEventSeqs: [] },
  )
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  session.append('turn/start', { turn: 2 })
  const u2 = session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'second user message' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append('step/start', { turn: 2, step: 1 })
  const a2 = session.append(
    'assistant/message',
    {
      turn: 2,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'second assistant message' }],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
    { surfaceOp: 'append', sourceEventSeqs: [] },
  )
  const call = session.append('tool/call', {
    turn: 2,
    step: 1,
    callId: CallId('c1'),
    name: 'read',
    arguments: JSON.stringify({ path: 'a.txt' }),
  })
  const result = session.append(
    'tool/result',
    {
      turn: 2,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('c1'),
        content: [{ type: 'text', text: 'file contents with enough text to price' }],
        isError: false,
      }),
    },
    { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
  )
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

  return {
    session,
    seqs: {
      u1: u1.seq,
      a1: a1.seq,
      u2: u2.seq,
      a2: a2.seq,
      call: call.seq,
      result: result.seq,
    },
  }
}

/** Create one text user message with a compact-checkpoint-derived source. */
export function checkpointUserMessage(
  summary: string,
  source: Record<string, unknown>,
): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{ type: 'text', text: summary }],
    source: source as never,
  })
}
