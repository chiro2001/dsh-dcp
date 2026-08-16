import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { reduceDcpState, applyDcpEvents } from '../../src/protocol/replay.js'
import { reconcileBlockMembership } from '../../src/protocol/replacements.js'
import {
  decodeDcpMeta,
  encodeDcpCheckpointSource,
  type DcpCheckpointMetaV1,
} from '../../src/protocol/metadata.js'
import { computeSessionStats } from '../../src/stats/session.js'

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function meta(blockRef: `b${number}`): DcpCheckpointMetaV1 {
  return {
    v: 1,
    kind: 'summary',
    blockRef,
    mode: 'range',
    topic: 'fuzz',
    startRef: 'm0001',
    endRef: 'm0002',
    authorMessageId: 'a',
    compressCallId: 'c',
    consumedBlockRefs: [],
    protectedKinds: [],
  }
}

describe('property/fuzz (M5)', () => {
  it('cold and incremental replay agree over random append/replace sequences', () => {
    const random = mulberry32(0xdecaf)
    const session = Session.create(SessionId('fuzz-replay'))
    let turn = 1
    for (let index = 0; index < 40; index++) {
      session.append('turn/start', { turn })
      session.append(
        'user/message',
        createUserMessage({
          content: [{ type: 'text', text: `user ${index}` }],
          source: { kind: 'user' },
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
            content: [{ type: 'text', text: `assistant ${index}` }],
            source: { provider: 'mock', model: 'mock' },
          }),
        },
        { surfaceOp: 'append', sourceEventSeqs: [] },
      )
      session.append('step/end', { turn, step: 1 })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })

      // Occasionally replace the first two surface nodes with a DCP block.
      if (random() < 0.25 && session.surface.nodes.length >= 4) {
        const [first, second] = session.surface.nodes
        session.append('turn/start', { turn: turn + 1 })
        session.append('step/start', { turn: turn + 1, step: 1 })
        const blockRef = `b${index}` as `b${number}`
        const compactionId = CompactionId(`fuzz-${index}`)
        session.append('compaction/start', { compactionId, turn: turn + 1 })
        session.append('compaction/summary', {
          compactionId,
          summary: [{ type: 'text', text: `summary ${index}` }],
          shadowedRange: { start: first!, end: second! },
          shadowedSeqs: [first!, second!],
          shadowedTokenCount: index + 1,
          provider: 'mock',
          model: 'mock',
        })
        session.append(
          'user/message',
          createUserMessage({
            content: [{ type: 'text', text: `summary ${index}` }],
            source: encodeDcpCheckpointSource(compactionId, meta(blockRef)),
          }),
          {
            surfaceOp: { op: 'replace', start: first!, end: second! },
            sourceEventSeqs: [first!, second!],
          },
        )
        session.append('compaction/end', { compactionId, turn: turn + 1 })
        session.append('step/end', { turn: turn + 1, step: 1 })
        session.append('turn/end', { turn: turn + 1, reason: { kind: 'completed' } })
        turn += 2
      } else {
        turn++
      }
    }

    const events = [...session.events]
    const cold = reduceDcpState(events)
    const cut = Math.floor(events.length / 2)
    const incremental = applyDcpEvents(reduceDcpState(events.slice(0, cut)), events.slice(cut))
    const serialize = (state: ReturnType<typeof reduceDcpState>) =>
      JSON.stringify({
        blocks: state.blocks,
        activeBlockRefs: state.activeBlockRefs,
        boundaryRefs: state.boundaryRefs,
        diagnostics: state.diagnostics,
        maxBlockNumber: state.maxBlockNumber,
      })
    expect(serialize(incremental)).toBe(serialize(cold))

    // Membership and stats are total functions over any legal log.
    const membership = reconcileBlockMembership(events)
    for (const block of cold.blocks) {
      expect(membership.get(block.ref)).toBeDefined()
    }
    const stats = computeSessionStats(events)
    expect(stats.blockCount).toBe(cold.blocks.length)
    expect(stats.netSavedTokens).toBeGreaterThanOrEqual(0)
  })

  it('metadata decoder never throws on malformed inputs', async () => {
    const random = mulberry32(0xfeed)
    const garbage: unknown[] = [null, 42, 'x', [], {}, { dcp: null }, { dcp: 'x' }]
    for (let index = 0; index < 200; index++) {
      const value =
        random() < 0.5
          ? garbage[index % garbage.length]
          : {
              kind: 'plugin',
              plugin: 'compact',
              compactionId: `c${index}`,
              dcp: { v: index % 5, kind: 'summary', blockRef: `b${index}` },
            }
      const result = decodeDcpMeta(value)
      expect(result.ok === true || result.ok === false).toBe(true)
      if (!result.ok) expect(result.diagnostic.code).toBeTypeOf('string')
    }
  })
})
