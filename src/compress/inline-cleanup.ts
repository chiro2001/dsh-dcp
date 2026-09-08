/**
 * Same-step inline summary cleanup (E-01 verified host contract).
 *
 * @module dsh-dcp/compress/inline-cleanup
 */

import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { freezeMessage } from '@deepseek-ai/dsh-llm/message'

export interface CleanupResult {
  cleaned: boolean
  /** Number of summary fields or malformed argument payloads inspected. */
  requested: number
  /** Number of fields/payloads replaced during this invocation. */
  rewritten: number
  /** Number of requested targets that could not be handled safely. */
  unhandled: number
  warning?: string
}

/** The durable state of one summary embedded in a model tool call. */
export type InlineSummaryStatus =
  | string
  | undefined
  | { status: 'committed'; blockRef: string }
  | { status: 'rejected'; code: string }

/**
 * Render the short marker left in the historical assistant tool call.
 *
 * The marker is deliberately not the checkpoint content.  The append-only
 * raw log still contains the original call, while the derived surface keeps
 * only this provenance-bearing status so a model cannot mistake a plugin
 * rewrite for its own shortened summary.
 */
export function inlineCleanupMarker(status: InlineSummaryStatus): string {
  if (typeof status === 'string') {
    return inlineCleanupMarker({ status: 'committed', blockRef: status })
  }
  const normalized = normalizeStatus(status)
  if (normalized.status === 'committed') {
    return `<dcp-inline-cleanup provenance="dsh-dcp" status="committed" block-ref="${normalized.blockRef}" />`
  }
  return `<dcp-inline-cleanup provenance="dsh-dcp" status="rejected" code="${normalized.code}" />`
}

const MALFORMED_INLINE_MARKER = inlineCleanupMarker({
  status: 'rejected',
  code: 'MALFORMED_ARGS',
})
const MALFORMED_ARGUMENTS_MARKER = JSON.stringify({ dcpCleanup: MALFORMED_INLINE_MARKER })

function normalizeStatus(
  status: InlineSummaryStatus,
): { status: 'committed'; blockRef: string } | { status: 'rejected'; code: string } {
  if (status !== undefined && typeof status !== 'string' && status.status === 'committed') {
    if (/^b\d+$/.test(status.blockRef)) return status
    return { status: 'rejected', code: 'INVALID_BLOCK_REF' }
  }
  if (status !== undefined && typeof status !== 'string' && status.status === 'rejected') {
    return { status: 'rejected', code: normalizeCode(status.code) }
  }
  if (typeof status === 'string' && /^b\d+$/.test(status)) {
    return { status: 'committed', blockRef: status }
  }
  return { status: 'rejected', code: status === undefined ? 'UNKNOWN' : 'INVALID_BLOCK_REF' }
}

function normalizeCode(code: string): string {
  const normalized = code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
  return normalized.length > 0 ? normalized.slice(0, 48) : 'UNKNOWN'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Whether an arguments string is the compact marker emitted for bad JSON. */
function isMalformedArgumentsMarker(argumentsText: string): boolean {
  try {
    const parsed: unknown = JSON.parse(argumentsText)
    return (
      isRecord(parsed) &&
      Object.keys(parsed).length === 1 &&
      parsed.dcpCleanup === MALFORMED_INLINE_MARKER
    )
  } catch {
    return false
  }
}

/**
 * Rewrite every model-provided inline summary inside the author assistant
 * message to a compact, provenance-bearing status marker.  This is used for
 * both committed and rejected ranges: a failed long summary must not remain
 * in the model-visible surface and compete with the later retry.  Requires an
 * open turn/step (tool execution context).
 */
export function cleanupInlineSummary(
  session: Session,
  tokenMeter: TokenMeter,
  compressCallId: string,
  statusesByIndex: readonly InlineSummaryStatus[],
): CleanupResult {
  let authorSeq: SessionSeq | undefined
  let original: SessionEvent | undefined
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq)
    if (event?.type !== 'assistant/message') continue
    const hasCall = event.data.message.content.some(
      (block) => block.type === 'tool-call' && block.id === compressCallId,
    )
    if (hasCall) {
      authorSeq = seq
      original = event
      break
    }
  }

  if (authorSeq === undefined || original?.type !== 'assistant/message') {
    return {
      cleaned: false,
      requested: 0,
      rewritten: 0,
      unhandled: 0,
      warning: 'author assistant message not found for inline cleanup',
    }
  }

  const message = original.data.message
  let rewritten = false
  let summaryCount = 0
  let rewrittenEntries = 0
  let unhandled = 0
  let targetArgumentCount = 0
  const content = message.content.map((block) => {
    if (block.type !== 'tool-call' || block.id !== compressCallId) return block
    targetArgumentCount++

    // A malformed JSON arguments payload cannot be inspected entry by entry.
    // Replace the complete payload with a tiny parseable provenance object so
    // a failed long summary cannot remain on the model-visible surface.
    if (isMalformedArgumentsMarker(block.arguments)) {
      summaryCount++
      return block
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(block.arguments)
    } catch {
      summaryCount++
      rewritten = true
      rewrittenEntries++
      return { ...block, arguments: MALFORMED_ARGUMENTS_MARKER }
    }

    // A parsed but schema-incompatible payload can still contain arbitrary
    // long values. Treat the whole arguments object as one target and replace
    // it, keeping the model-facing surface bounded just like malformed JSON.
    if (!isRecord(parsed) || !Array.isArray(parsed.content) || parsed.content.length === 0) {
      summaryCount++
      rewritten = true
      rewrittenEntries++
      return { ...block, arguments: MALFORMED_ARGUMENTS_MARKER }
    }

    const entries = parsed.content
    if (entries.some((entry) => !isRecord(entry) || typeof entry.summary !== 'string')) {
      summaryCount++
      rewritten = true
      rewrittenEntries++
      return { ...block, arguments: MALFORMED_ARGUMENTS_MARKER }
    }

    for (const [entryIndex, entry] of entries.entries()) {
      if (!isRecord(entry) || typeof entry.summary !== 'string') {
        // The shape check above makes this unreachable, but retain an explicit
        // accounting path if the persisted value changes between checks.
        unhandled++
        continue
      }
      summaryCount++
      // A previous finalizer/result observer may have already completed this
      // cleanup. Preserve the durable state only when it is the exact marker
      // this invocation expects. A model-authored marker with arbitrary
      // attributes or refs must never be trusted as a committed outcome.
      const expectedMarker = inlineCleanupMarker(statusesByIndex[entryIndex])
      if (entry.summary.trim() === expectedMarker) continue
      entry.summary = expectedMarker
      rewritten = true
      rewrittenEntries++
    }
    return { ...block, arguments: JSON.stringify(parsed) }
  })
  if (!rewritten) {
    return {
      cleaned: false,
      requested: summaryCount,
      rewritten: 0,
      unhandled,
      warning:
        targetArgumentCount > 0 && summaryCount > 0 && unhandled === 0
          ? 'inline summary arguments already cleaned'
          : 'no inline summary argument found to clean',
    }
  }

  const requested = summaryCount
  const cleaned = unhandled === 0 && targetArgumentCount > 0
  if (!cleaned) {
    return {
      cleaned: false,
      requested,
      rewritten: rewrittenEntries,
      unhandled,
      warning: 'some inline summary arguments could not be cleaned',
    }
  }

  const cleanedMessage = freezeMessage({ ...message, content } as never)
  session.append('compaction/prune', {
    shadowedRange: { start: authorSeq, end: authorSeq },
    shadowedSeqs: [authorSeq],
    shadowedTokenCount: tokenMeter.estimateMessage(message),
  })
  session.append(
    'assistant/message',
    {
      turn: original.data.turn,
      step: original.data.step,
      message: cleanedMessage,
    },
    {
      surfaceOp: { op: 'replace', start: authorSeq, end: authorSeq },
      sourceEventSeqs: [authorSeq],
    },
  )
  return {
    cleaned: true,
    requested,
    rewritten: rewrittenEntries,
    unhandled,
  }
}
