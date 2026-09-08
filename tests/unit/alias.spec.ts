import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { reduceDcpState } from '../../src/protocol/replay.js'
import { collectNativeAliases } from '../../src/refs/alias.js'
import { parseAlias } from '../../src/refs/marker.js'
import { resolveBoundaryPosition } from '../../src/refs/resolver.js'

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

    const state = reduceDcpState([...session.snapshotEvents()])
    const lines = collectNativeAliases(session, state, 8)
    expect(lines).toEqual([`alias m0001=s${replacement.seq}`])

    // Already-aliased or active markers produce nothing new.
    const capped = collectNativeAliases(session, state, 0)
    expect(capped).toEqual([])
  })

  it('follows a native replacement chain and lets the latest alias win', () => {
    const session = Session.create(SessionId('alias-chain'))
    const marker = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: '<dcp-boundary ref="m0001" turn="1" step="1" />' }],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
      { surfaceOp: 'append' },
    )

    const firstNativeId = CompactionId('native-n')
    session.append('compaction/start', { compactionId: firstNativeId, turn: null })
    session.append('compaction/summary', {
      compactionId: firstNativeId,
      summary: [{ type: 'text', text: 'native N' }],
      shadowedRange: { start: marker.seq, end: marker.seq },
      shadowedSeqs: [marker.seq],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    const nativeN = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'native N' }],
        source: compactCheckpointSource(firstNativeId),
      }),
      {
        surfaceOp: { op: 'replace', start: marker.seq, end: marker.seq },
        sourceEventSeqs: [marker.seq],
      },
    )
    session.append('compaction/end', { compactionId: firstNativeId, turn: null })
    session.append(
      'user/message',
      createUserMessage({
        content: [
          {
            type: 'text',
            text: `<dcp-boundary ref="m0002" turn="2" step="1" />\nalias m0001=s${nativeN.seq}`,
          },
        ],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
      { surfaceOp: 'append' },
    )

    const secondNativeId = CompactionId('native-m')
    session.append('compaction/start', { compactionId: secondNativeId, turn: null })
    session.append('compaction/summary', {
      compactionId: secondNativeId,
      summary: [{ type: 'text', text: 'native M' }],
      shadowedRange: { start: nativeN.seq, end: nativeN.seq },
      shadowedSeqs: [nativeN.seq],
      shadowedTokenCount: 1,
      provider: 'mock',
      model: 'mock',
    })
    const nativeM = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'native M' }],
        source: compactCheckpointSource(secondNativeId),
      }),
      {
        surfaceOp: { op: 'replace', start: nativeN.seq, end: nativeN.seq },
        sourceEventSeqs: [nativeN.seq],
      },
    )
    session.append('compaction/end', { compactionId: secondNativeId, turn: null })

    const beforeUpdate = reduceDcpState([...session.snapshotEvents()])
    expect(collectNativeAliases(session, beforeUpdate, 8)).toEqual([
      `alias m0001=s${nativeM.seq}`,
    ])

    const updateMarker = session.append(
      'user/message',
      createUserMessage({
        content: [
          {
            type: 'text',
            text: `<dcp-boundary ref="m0003" turn="3" step="1" />\nalias m0001=s${nativeN.seq}\nalias m0001=s${nativeM.seq}`,
          },
        ],
        source: { kind: 'plugin', plugin: 'dsh-dcp' },
      }),
      { surfaceOp: 'append' },
    )
    const state = reduceDcpState([...session.snapshotEvents()])
    expect(state.aliases.filter((alias) => alias.ref === 'm0001')).toEqual([
      { ref: 'm0001', seq: nativeM.seq },
    ])
    expect(
      resolveBoundaryPosition(
        [...session.surface.nodes],
        state.boundaryRefs,
        'm0001',
        state.aliases,
      ),
    ).toEqual({ position: session.surface.nodes.indexOf(nativeM.seq), seq: nativeM.seq })
    expect(updateMarker.seq).toBeGreaterThan(nativeM.seq)

    // An alias whose target is no longer on the current surface must fail closed.
    expect(
      resolveBoundaryPosition([...session.surface.nodes], state.boundaryRefs, 'm0001', [
        { ref: 'm0001', seq: nativeN.seq },
      ]),
    ).toBeUndefined()
    expect(
      resolveBoundaryPosition([...session.surface.nodes], state.boundaryRefs, 'm0001', [
        { ref: 'm0001', seq: nativeN.seq },
        { ref: 'm0001', seq: nativeM.seq },
      ]),
    ).toEqual({ position: session.surface.nodes.indexOf(nativeM.seq), seq: nativeM.seq })
    expect(parseAlias('alias m0001=s9007199254740992')).toBeUndefined()
  })
})
