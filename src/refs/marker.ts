/**
 * Boundary marker protocol (E-02 decision: candidate B).
 *
 * @module dsh-dcp/refs/marker
 */

export interface ParsedBoundaryMarker {
  ref: string
  turn: number
  step: number
}

import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

const MARKER_RE = /^<dcp-boundary ref="(m\d+)" turn="(\d+)" step="(\d+)" \/>$/
const ALIAS_RE = /^alias (m\d+)=s(\d+)$/
const BOUNDARY_REF_RE = /^m(\d+)$/

function isSafeNonNegativeIntegerText(value: string): boolean {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0
}

/** Whether a marker reference contains a safe, non-negative integer id. */
export function isSafeBoundaryRef(ref: string): boolean {
  const match = BOUNDARY_REF_RE.exec(ref)
  if (!match) return false
  return isSafeNonNegativeIntegerText(match[1])
}

export function buildBoundaryMarker(ref: string, turn: number, step: number): string {
  return `<dcp-boundary ref="${ref}" turn="${turn}" step="${step}" />`
}

export function parseBoundaryMarker(text: string): ParsedBoundaryMarker | undefined {
  const match = MARKER_RE.exec(text.trim())
  if (!match) return undefined
  const ref = match[1]!
  const turn = Number(match[2])
  const step = Number(match[3])
  if (!isSafeBoundaryRef(ref) || !Number.isSafeInteger(turn) || !Number.isSafeInteger(step)) {
    return undefined
  }
  return {
    ref,
    turn,
    step,
  }
}

export function buildAlias(ref: string, targetId: string): string {
  return `alias ${ref}=s${targetId}`
}

/** Logged step-entry marker message (protocol v1, candidate B). */
export function buildStepMarkerMessage(
  ref: string,
  turn: number,
  step: number,
  nudgeText?: string,
  extraText?: string,
): UserMessage {
  const base = buildBoundaryMarker(ref, turn, step)
  const text = [base, nudgeText, extraText].filter(Boolean).join('\n')
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-dcp' },
  })
}

export function parseAlias(text: string): { ref: string; targetId: string } | undefined {
  const match = ALIAS_RE.exec(text.trim())
  if (!match || !isSafeBoundaryRef(match[1]!) || !isSafeNonNegativeIntegerText(match[2]!)) {
    return undefined
  }
  return { ref: match[1]!, targetId: match[2]! }
}
