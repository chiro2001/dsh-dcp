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

export function buildBoundaryMarker(ref: string, turn: number, step: number): string {
  return `<dcp-boundary ref="${ref}" turn="${turn}" step="${step}" />`
}

export function parseBoundaryMarker(text: string): ParsedBoundaryMarker | undefined {
  const match = MARKER_RE.exec(text.trim())
  if (!match) return undefined
  return {
    ref: match[1]!,
    turn: Number(match[2]),
    step: Number(match[3]),
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
  if (!match) return undefined
  return { ref: match[1]!, targetId: match[2]! }
}
