/**
 * Deterministic DCP state replay over the session log (cold + incremental).
 *
 * @module dsh-dcp/protocol/replay
 */

import { foldSurface, type SessionEvent } from '@deepseek-ai/dsh-session'
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { decodeDcpMeta, type DcpCheckpointMetaV1, type DcpDiagnostic } from './metadata.js'
import { parseAlias } from '../refs/marker.js'
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
  aliases: Array<{ ref: string; seq: number }>
  pruneReplacements: Map<number, number>
  diagnostics: DcpDiagnostic[]
  maxBlockNumber: number
  maxMarkerNumber: number
  manualMode: boolean
}

const BOUNDARY_MARKER = /<dcp-boundary ref="(m\d+)"[^>]*\/>/g
const BLOCK_REF = /^b([1-9]\d*)$/
const MESSAGE_REF = /^m(\d+)$/

export function emptyDcpState(): DcpReplayState {
  return {
    protocolVersion: 1,
    log: [],
    blocks: [],
    activeBlockRefs: [],
    boundaryRefs: [],
    aliases: [],
    pruneReplacements: new Map(),
    diagnostics: [],
    maxBlockNumber: 0,
    maxMarkerNumber: 0,
    manualMode: false,
  }
}

/** Canonical cold replay: fold the complete log once. */
export function reduceDcpState(
  events: readonly SessionEvent[],
  manualDefault = false,
): DcpReplayState {
  const state = emptyDcpState()
  state.log = [...events]
  state.manualMode = manualDefault
  const surface = foldSurface(events)
  const surfaceSeqs = new Set(surface.nodes)
  const membership = reconcileBlockMembership(events)
  const aliasCandidates: Array<{ ref: string; seq: number }> = []

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
      // Active blocks are also boundary refs (bN) so ranges can nest.
      state.boundaryRefs.push({
        ref: decoded.meta.blockRef,
        seq: event.seq,
        active: membership.get(decoded.meta.blockRef) === 'active',
      })
    } else if (isCompactCheckpointSource(event.data.source as never)) {
      state.diagnostics.push({ ...decoded.diagnostic, seq: event.seq })
    }

    const source = event.data.source as unknown as { plugin?: string }
    if (source.plugin === 'dsh-dcp') {
      const text = event.data.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
      for (const match of event.data.content[0]?.type === 'text'
        ? event.data.content[0].text.matchAll(BOUNDARY_MARKER)
        : []) {
        const ref = match[1]!
        state.boundaryRefs.push({ ref, seq: event.seq, active: surfaceSeqs.has(event.seq) })
        const markerNumber = Number(MESSAGE_REF.exec(ref)?.[1] ?? 0)
        state.maxMarkerNumber = Math.max(state.maxMarkerNumber, markerNumber)
      }
      for (const line of text.split('\n')) {
        const alias = parseAlias(line)
        if (alias) aliasCandidates.push({ ref: alias.ref, seq: Number(alias.targetId) })
      }
    }
  }

  for (const alias of aliasCandidates) {
    if (events[alias.seq] !== undefined) state.aliases.push(alias)
  }

  state.pruneReplacements = foldPruneReplacements(events)

  // Manual mode derives from successful command lifecycle pairs.
  const pendingCommands = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'command/run') {
      if (event.data.name === 'dcp' && event.data.args !== undefined) {
        pendingCommands.set(String(event.data.commandId), event.data.args.trim())
      }
    }
    if (event.type === 'command/done') {
      const args = pendingCommands.get(String(event.data.commandId))
      if (event.data.kind === 'success' && args !== undefined) {
        if (args === 'manual on') state.manualMode = true
        if (args === 'manual off') state.manualMode = false
      }
      pendingCommands.delete(String(event.data.commandId))
    }
  }
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
