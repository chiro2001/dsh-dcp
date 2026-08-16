/**
 * M6.1 hot-path perf: full pre-step equivalent (replay + nudge + alias scan)
 * over 1k/4k/16k (optional 50k) events, with growth-ratio gates.
 */

import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { reduceDcpState } from '../src/protocol/replay.js'
import { collectNativeAliases } from '../src/refs/alias.js'
import { computeNudge } from '../src/prompts/nudge.js'
import { resolveConfig } from '../src/config.js'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'

function buildCorpus(turnCount: number): Session {
  const session = Session.create(SessionId(`hotpath-${turnCount}`))
  for (let turn = 1; turn <= turnCount; turn++) {
    session.append('turn/start', { turn })
    session.append(
      'user/message',
      createUserMessage({
        content: [
          {
            type: 'text',
            text: `<dcp-boundary ref="m${String(turn).padStart(4, '0')}" turn="${turn}" step="1" />`,
          },
          { type: 'text', text: `user ${turn}` },
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
        message: {
          id: `a${turn}`,
          role: 'assistant',
          content: [{ type: 'text', text: `reply ${turn}` }],
          source: { provider: 'mock', model: 'mock' },
        } as never,
      },
      { surfaceOp: 'append', sourceEventSeqs: [] },
    )
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })

    // Native absorption of the oldest marker every 64 turns stresses alias scan.
    if (turn % 64 === 0 && session.surface.nodes.length > 2) {
      const target = session.surface.nodes[0]!
      const nativeId = CompactionId(`native-${turn}`)
      session.append('compaction/start', { compactionId: nativeId, turn: null })
      session.append('compaction/summary', {
        compactionId: nativeId,
        summary: [{ type: 'text', text: 'native' }],
        shadowedRange: { start: target, end: target },
        shadowedSeqs: [target],
        shadowedTokenCount: 1,
        provider: 'mock',
        model: 'mock',
      })
      session.append(
        'user/message',
        createUserMessage({
          content: [{ type: 'text', text: 'native' }],
          source: compactCheckpointSource(nativeId),
        }),
        {
          surfaceOp: { op: 'replace', start: target, end: target },
          sourceEventSeqs: [target],
        },
      )
      session.append('compaction/end', { compactionId: nativeId, turn: null })
    }
  }
  return session
}

function hotPath(session: Session): number {
  const config = resolveConfig({})
  const measure = { totalTokens: 0 } as TokenMeasurement
  const start = performance.now()
  const state = reduceDcpState(session.events)
  computeNudge(session, measure, config)
  collectNativeAliases(session, state, config.references.maxAliasEntries)
  return performance.now() - start
}

const sizes = process.argv.includes('--scale')
  ? [1000, 4000, 16000, 50000]
  : [1000, 4000, 16000]
const timings: Array<{ n: number; ms: number }> = []
for (const size of sizes) {
  const session = buildCorpus(size)
  const ms = hotPath(session)
  timings.push({ n: size, ms })
  console.log(`hotpath ${size} events: ${ms.toFixed(1)}ms`)
}

for (let index = 1; index < timings.length; index++) {
  const previous = timings[index - 1]!
  const current = timings[index]!
  const ratio = current.ms / Math.max(1, previous.ms)
  const sizeRatio = current.n / previous.n
  console.log(`growth ${previous.n}->${current.n}: ${ratio.toFixed(2)}x (size ${sizeRatio}x)`)
  if (ratio > 6) {
    throw new Error(
      `hotpath growth gate failed: T(4n)/T(n)=${ratio.toFixed(2)} (> 6) at ${current.n} events`,
    )
  }
}

const largest = timings.at(-1)!
if (largest.ms > 2000) {
  throw new Error(`hotpath largest run ${largest.ms.toFixed(1)}ms (> 2000ms budget)`)
}
console.log('perf-hotpath: PASSED')
