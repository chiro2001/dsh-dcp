import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { collectNativeAliases } from '../../src/refs/alias.js'

describe('native alias collection (M6.1)', () => {
  it('emits aliases only for native-shadowed markers without existing alias', () => {
    const session = Session.create(SessionId('alias-collect'))
    const marker = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: '<dcp-boundary ref="m0001" turn="1" step="1" />' }],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
      { surfaceOp: 'append' },
    )
    const nativeId = CompactionId('native')
    session.append('compaction/start', { compactionId: nativeId, turn: null })
    session.append('compaction/summary', {
      compactionId: nativeId,
      summary: [{ type: 'text', text: 'native' }],
      shadowedRange: { start: marker.seq, end: marker.seq },
      shadowedSeqs: [marker.seq],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    const replacement = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'native' }],
        source: compactCheckpointSource(nativeId),
      }),
      {
        surfaceOp: { op: 'replace', start: marker.seq, end: marker.seq },
        sourceEventSeqs: [marker.seq],
      },
    )
    session.append('compaction/end', { compactionId: nativeId, turn: null })

    const state = reduceDcpState([...session.events])
    const lines = collectNativeAliases(session, state, 8)
    expect(lines).toEqual([`alias m0001=s${replacement.seq}`])

    // Already-aliased or active markers produce nothing new.
    const capped = collectNativeAliases(session, state, 0)
    expect(capped).toEqual([])
  })
})
