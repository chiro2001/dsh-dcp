/**
 * Resolve boundary refs to current surface positions (positional, never seq
 * numeric ordering).
 *
 * @module dsh-dcp/refs/resolver
 */

import type { DcpBoundaryRecord } from '../protocol/replay.js'
import type { SessionSeq } from '@deepseek-ai/dsh-session'

export type ResolveRangeResult =
  | {
      ok: true
      startSeq: SessionSeq
      endSeq: SessionSeq
      startPosition: number
      endPosition: number
    }
  | { ok: false; reason: string }

export function resolveBoundaryPosition(
  surface: readonly SessionSeq[],
  boundaryRefs: readonly DcpBoundaryRecord[],
  ref: string,
  aliases: readonly { ref: string; seq: SessionSeq }[] = [],
): { position: number; seq: SessionSeq } | undefined {
  const record = boundaryRefs.find((entry) => entry.ref === ref)
  if (record && record.active) {
    const position = surface.indexOf(record.seq)
    if (position !== -1) return { position, seq: record.seq }
  }
  let alias: { ref: string; seq: SessionSeq } | undefined
  for (const entry of aliases) {
    if (entry.ref === ref) alias = entry
  }
  if (alias) {
    const position = surface.indexOf(alias.seq)
    if (position !== -1) return { position, seq: alias.seq }
  }
  return undefined
}

/**
 * Half-open range `[startRef, endRef)`: endRef must be a boundary at or after
 * startRef, and both markers must be on the current surface.
 */
export function resolveRange(
  surface: readonly SessionSeq[],
  boundaryRefs: readonly DcpBoundaryRecord[],
  startRef: string,
  endRef: string,
  aliases: readonly { ref: string; seq: SessionSeq }[] = [],
): ResolveRangeResult {
  const start = resolveBoundaryPosition(surface, boundaryRefs, startRef, aliases)
  if (!start) {
    return { ok: false, reason: `startRef ${startRef} is not an active boundary` }
  }
  const end = resolveBoundaryPosition(surface, boundaryRefs, endRef, aliases)
  if (!end) {
    return { ok: false, reason: `endRef ${endRef} is not an active boundary` }
  }
  if (start.position >= end.position) {
    return { ok: false, reason: `startRef ${startRef} must appear before endRef ${endRef}` }
  }
  return {
    ok: true,
    startSeq: start.seq,
    endSeq: end.seq,
    startPosition: start.position,
    endPosition: end.position,
  }
}
