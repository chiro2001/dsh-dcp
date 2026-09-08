/**
 * Render the model-facing compress tool result.
 *
 * @module dsh-dcp/compress/result
 */

import { rejectedCompressResult, type CompressRangeResult } from './pipeline.js'
import { classifyCompressError, correctionForCompressFailure } from './schema.js'

/** Format a compact rejection for failures that bypass the range pipeline. */
export function formatCompressFailure(
  args: unknown,
  error: unknown,
  code = classifyCompressError(error),
): string {
  return formatCompressResult(rejectedCompressResult(args, error, code))
}

/**
 * Format the tool result string returned to the model.
 *
 * Besides reporting the committed blocks, this emits a compact and stable
 * status record.  In particular, rejected summaries are represented only by
 * their range/code; the potentially very long model-provided error text is
 * intentionally not copied into the next context window.
 */
export function formatCompressResult(result: CompressRangeResult): string {
  const status =
    result.status ??
    (result.failed.length === 0
      ? result.blocks.length > 0
        ? 'success'
        : 'rejected'
      : result.blocks.length > 0
        ? 'partial'
        : 'rejected')
  const committed = result.blocks.map((block) => block.blockRef)
  const messages = result.blocks.reduce((sum, block) => sum + block.compressedMessages, 0)
  const rejected = result.failed.map((entry) => {
    const code = entry.code ?? classifyCompressError(new Error(entry.error))
    return `${entry.startRef}..${entry.endRef}[${code}]`
  })
  const corrections = [
    ...new Set(
      result.failed.map((entry) => {
        const code = entry.code ?? classifyCompressError(new Error(entry.error))
        return entry.correction ?? correctionForCompressFailure(code, entry.error)
      }),
    ),
  ]

  if (status === 'success') {
    const cleanupNote = result.cleanupWarning
      ? ` cleanup=not-confirmed; checkpoint remains authoritative; cleanup warning=${result.cleanupWarning}.`
      : ' plugin rewrote the historical tool call after commit; cleanup=confirmed.'
    return (
      `Compressed ${messages} message(s) into ${committed.join(', ')}. ` +
      `status=success; committed=${committed.join(',') || 'none'}; rejected=none; ` +
      'correction=STOP; checkpoints contain the full summaries; do not retry committed ranges.' +
      cleanupNote
    )
  }

  const rejectedText = rejected.join(',') || 'none'
  if (status === 'partial') {
    const detail = corrections.length > 0 ? `; details=${corrections.join(' / ')}` : ''
    const cleanupNote = result.cleanupWarning
      ? `; cleanup=not-confirmed; cleanup warning=${result.cleanupWarning}`
      : '; cleanup=confirmed'
    return (
      `Compressed ${messages} message(s) into ${committed.join(', ')}. ` +
      `status=partial; committed=${committed.join(',') || 'none'}; ` +
      `rejected=${rejectedText}; correction=HANDLE ONLY the rejected ranges as directed; ` +
      `do not retry committed ranges${detail}${cleanupNote}.`
    )
  }

  const correction = corrections[0] ?? 'inspect the rejected ranges and retry with current refs'
  const warning = result.cleanupWarning ? ` cleanup warning=${result.cleanupWarning}.` : ''
  return (
    'Compression committed no ranges. ' +
    `status=rejected; committed=none; rejected=${rejectedText}; ` +
    `correction=${correction}. No range was committed; follow the correction exactly.${warning}`
  )
}
