/**
 * Deterministic DCP state replay over the session log (cold + incremental).
 *
 * @module dsh-dcp/protocol/replay
 */

import { foldSurface, type SessionEvent } from '@deepseek-ai/dsh-session'
import { decodeDcpMeta, type DcpCheckpointMetaV1, type DcpDiagnostic } from './metadata.js'
import {
  foldPruneReplacements,
  reconcileBlockMembership,
  type BlockMembership,
} from './replacements.js'

export interface DcpBlockRecord {
  ref: string
  seq: number
  meta: DcpCheckpointMetaV1
  membership: BlockMembership
}

export interface DcpBoundaryRecord {
  ref: string
  seq: number
  active: boolean
}

export interface DcpReplayState {
  protocolVersion: 1
  log: SessionEvent[]
  blocks: DcpBlockRecord[]
  activeBlockRefs: string[]
  boundaryRefs: DcpBoundaryRecord[]
  pruneReplacements: Map<number, number>
  diagnostics: DcpDiagnostic[]
  maxBlockNumber: number
  maxMarkerNumber: number
  manualMode: false
}

const BOUNDARY_MARKER = /<dcp-boundary ref="(m\d{4})"[^>]*\/>/g
const BLOCK_REF = /^b([1-9]\d*)$/
const MESSAGE_REF = /^m(\d{4})$/

export function emptyDcpState(): DcpReplayState {
  return {
    protocolVersion: 1,
    log: [],
    blocks: [],
    activeBlockRefs: [],
    boundaryRefs: [],
    pruneReplacements: new Map(),
    diagnostics: [],
    maxBlockNumber: 0,
    maxMarkerNumber: 0,
    manualMode: false,
  }
}

/** Canonical cold replay: fold the complete log once. */
export function reduceDcpState(events: readonly SessionEvent[]): DcpReplayState {
  const state = emptyDcpState()
  state.log = [...events]
  const surface = foldSurface(events)
  const surfaceSeqs = new Set(surface.nodes)
  const membership = reconcileBlockMembership(events)

  for (const event of events) {
    if (event.type !== 'user/message') continue
    const decoded = decodeDcpMeta(event.data.source)
    if (decoded.ok) {
      const record: DcpBlockRecord = {
        ref: decoded.meta.blockRef,
        seq: event.seq,
        meta: decoded.meta,
        membership: membership.get(decoded.meta.blockRef) ?? 'active',
      }
      state.blocks.push(record)
      if (record.membership === 'active') state.activeBlockRefs.push(record.ref)
      const blockNumber = Number(BLOCK_REF.exec(decoded.meta.blockRef)?.[1] ?? 0)
      state.maxBlockNumber = Math.max(state.maxBlockNumber, blockNumber)
    } else {
      state.diagnostics.push({ ...decoded.diagnostic, seq: event.seq })
    }

    const source = event.data.source as unknown as { plugin?: string }
    if (source.plugin === 'dsh-dcp') {
      for (const match of event.data.content[0]?.type === 'text'
        ? event.data.content[0].text.matchAll(BOUNDARY_MARKER)
        : []) {
        const ref = match[1]!
        state.boundaryRefs.push({ ref, seq: event.seq, active: surfaceSeqs.has(event.seq) })
        const markerNumber = Number(MESSAGE_REF.exec(ref)?.[1] ?? 0)
        state.maxMarkerNumber = Math.max(state.maxMarkerNumber, markerNumber)
      }
    }
  }

  state.pruneReplacements = foldPruneReplacements(events)
  return state
}

/**
 * Incremental update: append new events and refold. Deterministically equal to
 * a cold replay of the same log (test-enforced); a bounded incremental fold is
 * an M3 performance optimization, not a correctness shortcut.
 */
export function applyDcpEvents(
  previous: DcpReplayState,
  newEvents: readonly SessionEvent[],
): DcpReplayState {
  return reduceDcpState([...previous.log, ...newEvents])
}
