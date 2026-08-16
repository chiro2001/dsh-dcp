import { describe, expect, it } from 'vitest'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import {
  DCP_PROTOCOL_VERSION,
  decodeDcpMeta,
  encodeDcpCheckpointSource,
  isDcpCheckpointSource,
  type DcpCheckpointMetaV1,
} from '../../src/protocol/metadata.js'

function meta(overrides: Partial<DcpCheckpointMetaV1> = {}): DcpCheckpointMetaV1 {
  return {
    v: 1,
    kind: 'summary',
    blockRef: 'b1',
    mode: 'range',
    topic: 'topic',
    startRef: 'm0001',
    endRef: 'm0002',
    authorMessageId: 'a1',
    compressCallId: 'c1',
    consumedBlockRefs: [],
    protectedKinds: [],
    ...overrides,
  }
}

describe('dcp checkpoint metadata', () => {
  it('round-trips an encoded source', () => {
    const source = encodeDcpCheckpointSource(CompactionId('c-1'), meta())
    const decoded = decodeDcpMeta(source)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.meta).toEqual(meta())
    expect(isDcpCheckpointSource(source)).toBe(true)
  })

  it('fails closed on unknown versions', () => {
    const source = {
      ...compactCheckpointSource(CompactionId('c-2')),
      dcp: { ...meta(), v: 99 },
    }
    const decoded = decodeDcpMeta(source)
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(decoded.diagnostic.code).toBe('UNSUPPORTED_VERSION')
    expect(isDcpCheckpointSource(source)).toBe(false)
  })

  it('rejects non-compaction sources and malformed metadata', () => {
    expect(decodeDcpMeta({ kind: 'plugin', plugin: 'dsh-dcp' }).ok).toBe(false)
    expect(decodeDcpMeta(null).ok).toBe(false)
    expect(decodeDcpMeta([1, 2]).ok).toBe(false)
    expect(
      decodeDcpMeta({
        ...compactCheckpointSource(CompactionId('x')),
        dcp: { ...meta(), blockRef: 'x1' },
      }).ok,
    ).toBe(false)
    expect(
      decodeDcpMeta({
        ...compactCheckpointSource(CompactionId('x')),
        dcp: { ...meta(), mode: 'weird' },
      }).ok,
    ).toBe(false)
    expect(
      decodeDcpMeta({
        ...compactCheckpointSource(CompactionId('x')),
        dcp: { ...meta(), consumedBlockRefs: ['z'] },
      }).ok,
    ).toBe(false)
    expect(
      decodeDcpMeta({
        ...compactCheckpointSource(CompactionId('x')),
        dcp: { ...meta(), endRef: '' },
      }).ok,
    ).toBe(false)
    expect(
      decodeDcpMeta({
        ...compactCheckpointSource(CompactionId('x')),
        dcp: { ...meta(), recompressedFrom: 'z' },
      }).ok,
    ).toBe(false)
    expect(
      decodeDcpMeta({
        ...compactCheckpointSource(CompactionId('x')),
        dcp: { ...meta(), protectedKinds: 42 },
      }).ok,
    ).toBe(false)
    expect(
      decodeDcpMeta({
        ...compactCheckpointSource(CompactionId('x')),
        dcp: { ...meta(), authorMessageId: '' },
      }).ok,
    ).toBe(false)
    expect(
      decodeDcpMeta({
        ...compactCheckpointSource(CompactionId('x')),
        dcp: { ...meta(), compressCallId: '' },
      }).ok,
    ).toBe(false)
    expect(
      decodeDcpMeta({
        ...compactCheckpointSource(CompactionId('x')),
        dcp: { ...meta(), startRef: '' },
      }).ok,
    ).toBe(false)
    expect(
      decodeDcpMeta({
        ...compactCheckpointSource(CompactionId('x')),
        dcp: { ...meta(), kind: 'nope' },
      }).ok,
    ).toBe(false)
  })

  it('accepts expansion kind', () => {
    const decoded = decodeDcpMeta(
      encodeDcpCheckpointSource(CompactionId('c-3'), meta({ kind: 'expansion' })),
    )
    expect(decoded.ok).toBe(true)
    expect(DCP_PROTOCOL_VERSION).toBe(1)
  })
})
