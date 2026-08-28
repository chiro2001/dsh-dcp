/**
 * Render the model-facing compress tool result.
 *
 * @module dsh-dcp/compress/result
 */

import type { CompressRangeResult } from './pipeline.js'

/**
 * Format the tool result string returned to the model.
 *
 * Besides reporting the committed blocks, this explicitly tells the model
 * that the full summaries live in the checkpoint messages and that the
 * `[stored in bN]` markers inside the cleaned inline tool-call arguments are
 * only cleanup bookkeeping, not the stored summary content.
 */
export function formatCompressResult(result: CompressRangeResult): string {
  const warning = result.cleanupWarning ? ` (cleanup warning: ${result.cleanupWarning})` : ''
  const blockSummary = result.blocks.map((block) => block.blockRef).join(', ')
  const messages = result.blocks.reduce((sum, block) => sum + block.compressedMessages, 0)
  const failedSummary =
    result.failed.length > 0
      ? ` ${result.failed.length} range(s) failed: ${result.failed
          .map((entry) => `${entry.startRef}..${entry.endRef}: ${entry.error}`)
          .join('; ')}`
      : ''
  const cleanupNote =
    result.blocks.length > 0 && result.cleanupWarning === undefined
      ? ' Full summaries are stored in the new checkpoints; any [stored in bN] in the inline tool-call arguments is only the cleanup marker, not the stored summary.'
      : ''
  return `Compressed ${messages} message(s) into ${blockSummary}.${cleanupNote}${failedSummary}${warning}`
}
