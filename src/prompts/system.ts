/**
 * Static DCP system guidance (E-02 decision: stable content only; dynamic
 * refs/nudge live in logged markers or on-demand tools).
 *
 * @module dsh-dcp/prompts/system
 */

import type { DcpConfig } from '../config.js'

export const DCP_GUIDANCE_SECTION = 'dcp:guidance'
export const DCP_GUIDANCE_ORDER = 190

export function renderDcpGuidance(config: DcpConfig, manualMode: boolean): string {
  const lines: string[] = [
    '## Dynamic Context Pruning (DCP)',
    '',
    'You may compress closed, completed conversation ranges with the `compress` tool when they are no longer needed verbatim. This frees context for continuing work.',
    '',
    '- Ranges are half-open: `startRef` is included, `endRef` is excluded.',
    '- Only choose ranges that are closed and do not cut an in-flight tool call/result pair.',
    '- Do not compress the current turn, active tool work, protected user instructions, or protected tool outputs.',
    '- Protected content may be appended verbatim after your summary; do not omit it.',
    '- You may pass multiple non-overlapping closed ranges in one call; each range is committed as an independent transaction.',
    '- Summary text must be plain prose containing the actual technical content and must not begin with blockRef markers like `[b1]`; do not use pointer-only placeholders such as `[stored in bN]` — the plugin assigns the checkpoint id.',
    '- Each completed compression replaces the range with a summary checkpoint marked `<dcp-message-id>bN</dcp-message-id>`.',
    '- If a range is invalid (stale, overlapping, protected, or cuts an open tool pair), retry with a current, closed, safer range.',
    '- If a range is valid but saves too few tokens, do not retry the same small range: choose a LARGER older closed range or write a more compact high-fidelity summary; otherwise leave it uncompressed.',
  ]
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
