/**
 * Native-compaction alias emission (shared by pre-step and perf measurement).
 *
 * @module dsh-dcp/refs/alias
 */

import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
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
  const existingAliases = new Map<string, SessionSeq>()
  for (const alias of state.aliases) existingAliases.set(alias.ref, alias.seq)
  const replacements = new Map<SessionSeq, SessionSeq>()
  const events = session.snapshotEvents()
  for (const event of events) {
    if (event.type !== 'user/message' || event.surfaceOp === 'append') continue
    if (!isCompactCheckpointSource(event.data.source)) continue
    if (decodeDcpMeta(event.data.source).ok) continue
    for (const seq of event.sourceEventSeqs ?? []) replacements.set(seq, event.seq)
  }
  const surface = new Set(session.surface.nodes)

  const latestReplacement = (initial: SessionSeq): SessionSeq | undefined => {
    let current = initial
    const visited = new Set<SessionSeq>()
    while (true) {
      if (visited.has(current)) return undefined
      visited.add(current)
      const next = replacements.get(current)
      if (next === undefined) return current
      current = next
    }
  }

  for (const marker of state.boundaryRefs) {
    if (marker.active) continue
    if (aliasLines.length >= maxEntries) break
    const directReplacement = replacements.get(marker.seq)
    const priorAlias = existingAliases.get(marker.ref)
    const replacementSeq = latestReplacement(directReplacement ?? priorAlias ?? marker.seq)
    if (replacementSeq === undefined || !surface.has(replacementSeq)) continue
    if (priorAlias === replacementSeq) continue
    aliasLines.push(buildAlias(marker.ref, String(replacementSeq)))
  }
  return aliasLines
}
