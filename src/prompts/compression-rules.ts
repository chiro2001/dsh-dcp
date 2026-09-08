/**
 * Maintainer-owned compression rules.
 *
 * Keep the model-facing safety contract, result state machine, and summary
 * fidelity template in this file.  These rules are intentionally static: the
 * system prompt must not change on every step and cause request-header churn.
 * Resolved limits belong in the compress tool description, which is rendered
 * once when the tool is registered.
 *
 * Safety invariants (do not weaken while editing this block):
 * - ranges cover closed history, use half-open surface intervals, and never include live work;
 * - a rejected call commits nothing, while a partial result retries failures;
 * - a successful range is authoritative and must not be retried;
 * - cleanup is an append-only, post-execution rewrite of the historical call;
 * - the agent-loop request must continue to equal session.deriveMessages().
 */

import type { DcpConfig } from '../config.js'

/** Stable guidance included in the system prompt. Keep this section focused. */
export const DCP_COMPRESSION_RULES = [
  '### DCP compression rules (authoritative)',
  '',
  'Trigger:',
  '- Call `compress` only on an explicit user request, a DCP nudge, or clear pressure with savings; tool availability alone is not a trigger.',
  '',
  'Safety invariants:',
  '- Compress only closed history. Exclude the current turn, live work, open tool pairs, protected instructions, and protected outputs.',
  '- Preserve plugin-appended protected content verbatim.',
  '- Ranges are half-open `[startRef, endRef)`: include start, exclude end. Stale or ambiguous refs fail closed; never widen.',
  '- Compression is logged; requests derive from the session log, with no request-time rewrite.',
  '',
  'Result state machine:',
  '- `rejected`: no range committed. Execute the returned correction only; do not repeat the call or paste its rejected long summary.',
  '- `partial`: only listed successes committed. Keep them; retry only failed ranges with current refs.',
  '- `success`: checkpoints are authoritative. Stop; never retry a successful range.',
  '- A committed range becomes checkpoint `<dcp-message-id>bN</dcp-message-id>`.',
  '- After execution, the plugin may rewrite historical summaries to `<dcp-inline-cleanup provenance="dsh-dcp" status="committed" block-ref="bN" />` or a rejected marker. This post-execution rewrite is cleanup metadata, not the submitted summary or data loss; only a committed checkpoint is authoritative, while a rejected marker means no commit.',
  '',
  'Range selection:',
  '- Prefer one coherent phase/topic; preserve decisions, artifacts, failures, verification, open work.',
  '- No old-to-new ordering is required; submit safe non-overlapping ranges in any order. The plugin orders them internally.',
  '- Split broad, heterogeneous history by unrelated phase/topic when useful; do not split a small coherent range just to fill the limit.',
  '',
  'Summary fidelity:',
  '- Use technical prose, never pointers. Preserve facts; if savings conflicts with fidelity, choose another boundary or skip.',
  '- Substantial ranges: use applicable fields: `Goal:`; `Constraints:`; `Decisions:`; `Artifacts:`; `Failures:`; `Verification:`; `Open work:`. Omit empty fields/titles; never fill `none`.',
  '- For a small, single-purpose range: compact high-fidelity prose; no empty headings.',
].join('\n')

/**
 * Return the stable system-prompt section. Kept as a function so callers do
 * not accidentally interpolate per-step state into the guidance.
 */
export function renderCompressionRules(): string {
  return DCP_COMPRESSION_RULES
}

const COMPRESS_CALL_TEMPLATE = `{
  "topic": "<COHERENT_PHASE>",
  "content": [
    {
      "startRef": "<CURRENT_CLOSED_START_REF>",
      "endRef": "<CURRENT_CLOSED_END_REF>",
      "summary": "Goal: <...>\\nConstraints: <...>\\nDecisions: <...>\\nArtifacts: <...>\\nFailures: <...>\\nVerification: <...>\\nOpen work: <...>"
    }
  ]
}`

/**
 * Render the model-facing tool description once with resolved configuration.
 * Do not call this from agent/pre-step or otherwise make it step-dependent.
 */
export function renderCompressToolDescription(config: DcpConfig): string {
  const policy = config.compress
  return [
    'Compress closed conversation ranges into summary checkpoints.',
    '',
    `Resolved policy: retainRecentTurns=${policy.retainRecentTurns}; minNetSavingsTokens=${policy.minNetSavingsTokens}; maxRangesPerCall=${policy.maxRangesPerCall}.`,
    `Keep the newest ${policy.retainRecentTurns} complete turns. Commit only if savings reach ${policy.minNetSavingsTokens} estimated tokens; submit at most ${policy.maxRangesPerCall} non-overlapping ranges.`,
    '',
    'Call template (use applicable fields): replace every `<...>` placeholder with current context values; never submit placeholders.',
    '```json',
    COMPRESS_CALL_TEMPLATE,
    '```',
    '',
    'Schema essentials: `[startRef, endRef)` includes start and excludes end; refs must be current, closed, balanced, and exclude live/protected content.',
    'Summary: substantial ranges use applicable fields from the template. A small, single-purpose range may use a compact high-fidelity paragraph. Omit empty fields/titles; do not mechanically fill "none". Use prose, never a pointer; preserve facts and do not omit them to reach savings.',
    'If validation rejects the call: Execute the returned correction only; do not resend unchanged arguments.',
  ].join('\n')
}
