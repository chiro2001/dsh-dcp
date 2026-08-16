/**
 * Resolve boundary refs to current surface positions (positional, never seq
 * numeric ordering).
 *
 * @module dsh-dcp/refs/resolver
 */

import type { DcpBoundaryRecord } from '../protocol/replay.js'

export type ResolveRangeResult =
  | { ok: true; startSeq: number; endSeq: number; startPosition: number; endPosition: number }
  | { ok: false; reason: string }

export function resolveBoundaryPosition(
  surface: readonly number[],
  boundaryRefs: readonly DcpBoundaryRecord[],
  ref: string,
): { position: number; seq: number } | undefined {
  const record = boundaryRefs.find((entry) => entry.ref === ref)
  if (!record || !record.active) return undefined
  const position = surface.indexOf(record.seq)
  if (position === -1) return undefined
  return { position, seq: record.seq }
}

/**
 * Half-open range `[startRef, endRef)`: endRef must be a boundary at or after
 * startRef, and both markers must be on the current surface.
 */
export function resolveRange(
  surface: readonly number[],
  boundaryRefs: readonly DcpBoundaryRecord[],
  startRef: string,
  endRef: string,
): ResolveRangeResult {
  const start = resolveBoundaryPosition(surface, boundaryRefs, startRef)
  if (!start) {
    return { ok: false, reason: `startRef ${startRef} is not an active boundary` }
  }
  const end = resolveBoundaryPosition(surface, boundaryRefs, endRef)
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
