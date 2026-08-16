import { foldSurface, type SessionEvent } from '@deepseek-ai/dsh-session'

export type BlockMembership = 'active' | 'consumed' | 'absorbed-native' | 'expanded'

/**
 * Reconcile DCP block refs against the current surface membership and the
 * replacement DAG (revised PLAN §11): active nodes win; a checkpoint shadowed
 * by a later DCP checkpoint is `consumed`; shadowed by a native compaction
 * checkpoint is `absorbed-native`; shadowed by an expansion is `expanded`.
 */
export function reconcileBlockMembership(
  events: readonly SessionEvent[],
): Map<string, BlockMembership> {
  const result = new Map<string, BlockMembership>()
  const surface = new Set(foldSurface(events).nodes)
  const dcpBlocks: Array<{ ref: string; seq: number }> = []

  for (const event of events) {
    if (event.type !== 'user/message') continue
    const source = event.data.source as unknown as {
      dcp?: { blockRef?: string; kind?: string }
    }
    if (source?.dcp?.blockRef) {
      dcpBlocks.push({ ref: source.dcp.blockRef, seq: event.seq })
      result.set(source.dcp.blockRef, surface.has(event.seq) ? 'active' : 'consumed')
    }
  }

  // Walk replacements in event order; a DCP block shadowed by a non-DCP
  // replacement is native-absorbed (or expanded by a DCP expansion).
  for (const event of events) {
    if (event.type !== 'user/message' || event.surfaceOp === 'append') continue
    const source = event.data.source as unknown as { dcp?: { kind?: string } }
    const shadowed = new Set(event.sourceEventSeqs ?? [])
    for (const block of dcpBlocks) {
      if (!shadowed.has(block.seq)) continue
      if (source?.dcp?.kind === 'expansion') {
        result.set(block.ref, 'expanded')
      } else if (!source?.dcp) {
        result.set(block.ref, 'absorbed-native')
      } else {
        result.set(block.ref, 'consumed')
      }
    }
  }

  return result
}
