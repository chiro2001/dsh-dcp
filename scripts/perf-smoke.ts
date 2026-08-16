/**
 * Perf smoke: replay 200 and 1000 surface nodes within a generous budget.
 * Guards against O(n^2) regressions in DCP state replay.
 */

import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { reduceDcpState } from '../src/protocol/replay.js'
import { buildBoundaryMarker } from '../src/refs/marker.js'

function buildSession(nodeCount: number): Session {
  const session = Session.create(SessionId(`perf-${nodeCount}`))
  let turn = 1
  for (let index = 0; index < nodeCount; index++) {
    session.append('turn/start', { turn })
    session.append(
      'user/message',
      createUserMessage({
        content: [
          {
            type: 'text',
            text: buildBoundaryMarker(`m${String(index + 1).padStart(4, '0')}`, turn, 1),
          },
          { type: 'text', text: `user message ${index} with enough text to price` },
        ],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
      { surfaceOp: 'append' },
    )
    session.append('step/start', { turn, step: 1 })
    session.append(
      'assistant/message',
      {
        turn,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: `assistant reply ${index}` }],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
    turn++
  }
  return session
}

function smoke(nodeCount: number): number {
  const session = buildSession(nodeCount)
  const start = performance.now()
  const state = reduceDcpState(session.events)
  const elapsed = performance.now() - start
  if (state.boundaryRefs.length !== nodeCount) {
    throw new Error(
      `perf smoke: expected ${nodeCount} boundary refs, got ${state.boundaryRefs.length}`,
    )
  }
  return elapsed
}

const small = smoke(200)
const large = smoke(1000)
console.log(`perf smoke: 200 nodes ${small.toFixed(1)}ms, 1000 nodes ${large.toFixed(1)}ms`)
if (large > 2000) {
  throw new Error(`perf smoke: 1000-node replay took ${large.toFixed(1)}ms (> 2000ms budget)`)
}
console.log('perf smoke: PASSED')
