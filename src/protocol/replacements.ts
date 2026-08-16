/**
 * Replacement DAG and block-membership reconciliation over the session log.
 *
 * @module dsh-dcp/protocol/replacements
 */

import { foldSurface, type SessionEvent } from '@deepseek-ai/dsh-session'
import { decodeDcpMeta } from './metadata.js'

export type BlockMembership = 'active' | 'consumed' | 'absorbed-native' | 'expanded'

/** Current block membership derived from surface membership + replacement DAG. */
export function reconcileBlockMembership(
  events: readonly SessionEvent[],
): Map<string, BlockMembership> {
  const result = new Map<string, BlockMembership>()
  const surface = new Set(foldSurface(events).nodes)
  const blocks: Array<{ ref: string; seq: number }> = []

  for (const event of events) {
    if (event.type !== 'user/message') continue
    const decoded = decodeDcpMeta(event.data.source)
    if (!decoded.ok) continue
    blocks.push({ ref: decoded.meta.blockRef, seq: event.seq })
    result.set(decoded.meta.blockRef, surface.has(event.seq) ? 'active' : 'consumed')
  }

  for (const event of events) {
    if (event.type !== 'user/message' || event.surfaceOp === 'append') continue
    const decoded = decodeDcpMeta(event.data.source)
    const shadowed = new Set(event.sourceEventSeqs ?? [])
    for (const block of blocks) {
      if (!shadowed.has(block.seq)) continue
      if (decoded.ok && decoded.meta.kind === 'expansion') {
        result.set(block.ref, 'expanded')
      } else if (!decoded.ok) {
        result.set(block.ref, 'absorbed-native')
      } else {
        result.set(block.ref, 'consumed')
      }
    }
  }

  return result
}

/** Single-node tool-result rewrites: original seq -> replacement seq. */
export function foldPruneReplacements(events: readonly SessionEvent[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const event of events) {
    if (event.type !== 'tool/result' || event.surfaceOp === 'append') continue
    const sources = event.sourceEventSeqs ?? []
    if (sources.length === 1) result.set(sources[0]!, event.seq)
  }
  return result
}
