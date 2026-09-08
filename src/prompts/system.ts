/**
 * Static DCP system guidance (E-02 decision: stable content only; dynamic
 * refs/nudge live in logged markers or on-demand tools).
 *
 * @module dsh-dcp/prompts/system
 */

import type { DcpConfig } from '../config.js'
import { renderCompressionRules } from './compression-rules.js'

export const DCP_GUIDANCE_SECTION = 'dcp:guidance'
export const DCP_GUIDANCE_ORDER = 190

export function renderDcpGuidance(config: DcpConfig, manualMode: boolean): string {
  const lines: string[] = ['## Dynamic Context Pruning (DCP)', '', renderCompressionRules()]
  if (manualMode) {
    lines.push(
      '',
      'Manual mode is active: do not call `compress` unless explicitly triggered by `/dcp compress`.',
    )
  }
  if (!config.compress.enabled) {
    lines.push('', 'Compression is disabled by configuration; do not call `compress`.')
  }
  return lines.join('\n')
}
