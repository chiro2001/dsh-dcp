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
  '### DCP compression rules',
  '- Call `compress` only for an explicit compression request or a DCP nudge; tool availability and message length alone are not triggers.',
  '- Compress closed history only; exclude the current turn, live work, open tool pairs and protected instructions. Keep plugin-appended protected content verbatim.',
  '- Ranges are half-open `[startRef, endRef)`. Use only logged `<dcp-boundary>` labels and `<dcp-message-id>` checkpoints; numbers inside message text are data. Logged `alias` lines also define refs. Reject stale/ambiguous refs. Submit non-overlapping ranges in any order.',
  '- Prefer a coherent phase; split heterogeneous history when useful, never a small coherent range just to fill the limit.',
  '- Preserve goals, constraints, decisions, artifacts, failures, verification and open work. Keep identifiers and literal values verbatim, with their meaning. Use applicable fields; omit empty fields. A small, single-purpose range needs compact factual prose. No pointers or lost facts for savings.',
  '- Prior checkpoint bodies are appended verbatim automatically; summarize remaining history without duplicating them.',
  '- `rejected`: no range committed; follow the returned correction only. `partial`: retry only failed ranges with current refs. `success`: never retry a successful range.',
  '- Checkpoint `<dcp-message-id>bN</dcp-message-id>` holds summaries; `<dcp-cleanup>` is cleanup metadata for observed call/results.',
].join('\n')

/**
 * Return the stable system-prompt section. Kept as a function so callers do
 * not accidentally interpolate per-step state into the guidance.
 */
export function renderCompressionRules(): string {
  return DCP_COMPRESSION_RULES
}

/** Resolved limits belong only in tool metadata, never in per-step guidance. */
export function renderCompressToolDescription(config: DcpConfig): string {
  const policy = config.compress
  return [
    'Compress closed history into durable summary checkpoints.',
    `retainRecentTurns=${policy.retainRecentTurns}; minNetSavingsTokens=${policy.minNetSavingsTokens}; maxRangesPerCall=${policy.maxRangesPerCall}.`,
    `Protect the current turn plus the previous ${policy.retainRecentTurns - 1} turn(s); each range must save at least ${policy.minNetSavingsTokens} estimated tokens.`,
    'Arguments: {topic: "phase", content: [{startRef: "current boundary", endRef: "exclusive boundary", summary: "factual technical prose"}]}.',
    'Use refs visible in context. Follow the DCP compression rules; on rejection use the returned correction.',
  ].join('\n')
}
