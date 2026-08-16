/**
 * Native-compaction alias emission (shared by pre-step and perf measurement).
 *
 * @module dsh-dcp/refs/alias
 */

import type { Session } from '@deepseek-ai/dsh-session'
import { decodeDcpMeta } from '../protocol/metadata.js'
import type { DcpReplayState } from '../protocol/replay.js'
import { buildAlias } from './marker.js'

/**
 * For every inactive marker without an existing alias, find the native
 * replacement node that shadowed it and emit `alias ref=s<seq>` lines,
 * capped by `maxEntries`.
 */
export function collectNativeAliases(
  session: Session,
  state: DcpReplayState,
  maxEntries: number,
): string[] {
  const aliasLines: string[] = []
  const emitted = new Set(state.aliases.map((alias) => alias.ref))
  const replacements = new Map<number, number>()
  for (const event of session.events) {
    if (event.type !== 'user/message' || event.surfaceOp === 'append') continue
    if (decodeDcpMeta(event.data.source).ok) continue
    for (const seq of event.sourceEventSeqs ?? []) replacements.set(seq, event.seq)
  }
  for (const marker of state.boundaryRefs) {
    if (marker.active || emitted.has(marker.ref)) continue
    if (aliasLines.length >= maxEntries) break
    const replacementSeq = replacements.get(marker.seq)
    if (replacementSeq !== undefined) {
      aliasLines.push(buildAlias(marker.ref, String(replacementSeq)))
    }
  }
  return aliasLines
}
