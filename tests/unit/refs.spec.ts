import { describe, expect, it } from 'vitest'
import {
  buildAlias,
  buildBoundaryMarker,
  buildStepMarkerMessage,
  parseAlias,
  parseBoundaryMarker,
} from '../../src/refs/marker.js'
import { resolveBoundaryPosition, resolveRange } from '../../src/refs/resolver.js'
import type { DcpBoundaryRecord } from '../../src/protocol/replay.js'

describe('boundary markers', () => {
  it('round-trips markers and aliases', () => {
    const marker = buildBoundaryMarker('m0007', 4, 2)
    expect(marker).toBe('<dcp-boundary ref="m0007" turn="4" step="2" />')
    expect(parseBoundaryMarker(marker)).toEqual({ ref: 'm0007', turn: 4, step: 2 })
    expect(parseBoundaryMarker('<dcp-message-id>b1</dcp-message-id>')).toBeUndefined()

    const alias = buildAlias('m0007', '42')
    expect(alias).toBe('alias m0007=s42')
    expect(parseAlias(alias)).toEqual({ ref: 'm0007', targetId: '42' })
    expect(parseAlias('not an alias')).toBeUndefined()
  })

  it('builds a logged step marker with optional nudge text', () => {
    const message = buildStepMarkerMessage('m0001', 1, 1, 'DCP compression recommended')
    expect(message.source).toEqual({ kind: 'plugin', plugin: 'dsh-dcp' })
    expect(message.content[0]?.type).toBe('text')
    if (message.content[0]?.type === 'text') {
      expect(message.content[0].text).toContain(
        '<dcp-boundary ref="m0001" turn="1" step="1" />',
      )
      expect(message.content[0].text).toContain('DCP compression recommended')
    }
  })
})

describe('boundary resolver', () => {
  const surface = [10, 20, 30, 40]
  const refs: DcpBoundaryRecord[] = [
    { ref: 'm0001', seq: 10, active: true },
    { ref: 'm0002', seq: 30, active: true },
    { ref: 'm0003', seq: 40, active: false },
  ]

  it('resolves half-open positional ranges', () => {
    const resolved = resolveRange(surface, refs, 'm0001', 'm0002', [])
    expect(resolved).toEqual({
      ok: true,
      startSeq: 10,
      endSeq: 30,
      startPosition: 0,
      endPosition: 2,
    })
  })

  it('fails on stale, missing, or reversed refs', () => {
    expect(resolveRange(surface, refs, 'm0003', 'm0001', []).ok).toBe(false)
    expect(resolveRange(surface, refs, 'm0001', 'm9999', []).ok).toBe(false)
    expect(resolveRange(surface, refs, 'm0002', 'm0001', []).ok).toBe(false)
  })

  it('resolves stale markers through aliases and fails without one', () => {
    const aliases = [{ ref: 'm0003', seq: 40 }]
    expect(resolveRange(surface, refs, 'm0003', 'm0001', aliases).ok).toBe(false)
    expect(resolveBoundaryPosition(surface, refs, 'm0003', aliases)).toEqual({
      position: 3,
      seq: 40,
    })
    expect(resolveBoundaryPosition(surface, refs, 'm0009', [])).toBeUndefined()
  })
})
