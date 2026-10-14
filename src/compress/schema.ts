/**
 * compress tool input schema and validation.
 *
 * @module dsh-dcp/compress/schema
 */

export interface CompressRangeEntry {
  startRef: string
  endRef: string
  summary: string
}

export interface CompressRangeArgs {
  topic: string
  content: CompressRangeEntry[]
}

/** Stable failure categories used by inline cleanup and model-facing results. */
export type CompressFailureCode =
  | 'INVALID_ARGS'
  | 'STALE_REF'
  | 'RANGE_ORDER'
  | 'EMPTY_RANGE'
  | 'UNBALANCED_TOOL_RANGE'
  | 'RECENT_RANGE'
  | 'PROTECTED_RANGE'
  | 'INSUFFICIENT_SAVINGS'
  | 'BUSY'
  | 'CURRENT_CALL'
  | 'RANGE_CHANGED'
  | 'ABORTED'
  | 'TIMEOUT'
  | 'DENIED'
  | 'UNKNOWN'

/** Convert an implementation error into a small, stable model-facing code. */
export function classifyCompressError(error: unknown): CompressFailureCode {
  const message = error instanceof Error ? error.message : String(error)
  if (
    /invalid arguments|topic must be|content\[|content accepts|summary must|startRef must|endRef must/i.test(
      message,
    )
  ) {
    return 'INVALID_ARGS'
  }
  if (/not an active boundary|stale ref/i.test(message)) return 'STALE_REF'
  if (/must appear before|must be in surface order|overlaps|non-overlapping/i.test(message)) {
    return 'RANGE_ORDER'
  }
  if (/is empty|must not be empty|content must not be empty/i.test(message))
    return 'EMPTY_RANGE'
  if (/open tool call|tool call\/result pair|unbalanced/i.test(message)) {
    return 'UNBALANCED_TOOL_RANGE'
  }
  if (/last .*turn|recent turn|retainRecentTurns/i.test(message)) return 'RECENT_RANGE'
  if (
    /hard-protected|protected instruction|protected .* output|protected range/i.test(message)
  ) {
    return 'PROTECTED_RANGE'
  }
  if (/minNetSavingsTokens|below min|saves ~.*below/i.test(message)) {
    return 'INSUFFICIENT_SAVINGS'
  }
  if (/compaction is busy|unclosed bracket|busy/i.test(message)) return 'BUSY'
  if (/current compress call|current call/i.test(message)) return 'CURRENT_CALL'
  if (/range changed before commit|range moved before commit/i.test(message))
    return 'RANGE_CHANGED'
  if (/timeout|timed out|deadline/i.test(message)) return 'TIMEOUT'
  if (/abort|cancel/i.test(message)) return 'ABORTED'
  if (/denied|rejected|approval/i.test(message)) return 'DENIED'
  return 'UNKNOWN'
}

/** Classify a dsh tool-pipeline failure, including its optional info code. */
export function classifyCompressToolFailure(error: unknown): CompressFailureCode {
  if (error !== null && typeof error === 'object') {
    const record = error as { message?: unknown; info?: { code?: unknown } }
    const code = typeof record.info?.code === 'string' ? record.info.code : undefined
    if (code !== undefined) {
      if (/^INVALID_ARGS$/i.test(code)) return 'INVALID_ARGS'
      if (/TIMEOUT|DEADLINE/i.test(code)) return 'TIMEOUT'
      if (/ABORT/i.test(code)) return 'ABORTED'
      if (/DENY|REJECT|APPROVAL/i.test(code)) return 'DENIED'
    }
    return classifyCompressError(record.message ?? error)
  }
  return classifyCompressError(error)
}

function dynamicHint(message: string, key: string): string | undefined {
  const value = new RegExp(`\\[${key}=([^\\]]+)\\]`).exec(message)?.[1]
  if (value === 'none') return value
  if (!value || !/^[mb]\d+$/.test(value)) return undefined
  const number = Number(value.slice(1))
  return Number.isSafeInteger(number) && number >= 0 ? value : undefined
}

function savingsGapHint(message: string): number | undefined {
  const value = /\[savingsGapTokens=(\d+)\]/.exec(message)?.[1]
  if (value === undefined) return undefined
  const gap = Number(value)
  return Number.isSafeInteger(gap) && gap >= 0 ? gap : undefined
}

/** Give the model one actionable correction without exposing implementation details. */
export function correctionForCompressFailure(
  code: CompressFailureCode,
  error?: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  switch (code) {
    case 'INVALID_ARGS':
      return 'fix the compress schema and retry the rejected ranges'
    case 'STALE_REF':
      return 'refresh refs from the current context and retry'
    case 'RANGE_ORDER':
      return 'ranges must not overlap; each startRef appears before its endRef'
    case 'EMPTY_RANGE':
      return 'choose a non-empty closed range'
    case 'UNBALANCED_TOOL_RANGE':
      return 'move the boundary outside the open tool-call/result pair'
    case 'RECENT_RANGE': {
      const endRef = dynamicHint(message, 'latestEligibleEndRef')
      if (endRef === 'none')
        return 'skip this range; no eligible endRef remains outside retained turns'
      if (endRef !== undefined) {
        return `choose an endRef at or before ${endRef}; keep retained recent turns out of the range`
      }
      return 'choose an older range outside the retained recent turns'
    }
    case 'PROTECTED_RANGE': {
      const startRef = dynamicHint(message, 'nextActiveBoundary')
      if (startRef === 'none') {
        return 'skip this range; no active boundary remains after the protected node'
      }
      if (startRef !== undefined) {
        return `choose a startRef at or after ${startRef} to skip the protected node`
      }
      return 'exclude protected instructions, user content, or tool output'
    }
    case 'INSUFFICIENT_SAVINGS': {
      const gap = savingsGapHint(message)
      const savings =
        gap === undefined
          ? 'preserve the same facts in a more compact summary'
          : `preserve the same facts in a more compact summary and save at least ${gap} more token(s)`
      return `${savings}, or choose a larger older range with the same topic; otherwise skip this range`
    }
    case 'BUSY':
      return 'wait for the active compaction transaction to finish, then retry'
    case 'CURRENT_CALL':
      return 'end the range before the current compress call'
    case 'RANGE_CHANGED':
      return 'refresh current refs and retry the changed range'
    case 'ABORTED':
      return 'do not retry until the current step is no longer cancelled'
    case 'TIMEOUT':
      return 'wait for the timeout to clear, then retry with a smaller range'
    case 'DENIED':
      return 'resolve the tool approval or guard denial before retrying'
    case 'UNKNOWN':
      return message.length > 0
        ? 'choose a new valid range; do not repeat the rejected call unchanged'
        : 'inspect the rejected range and retry with current refs'
  }
}

export function validateCompressArgs(args: unknown, maxRanges: number): string[] {
  const errors: string[] = []
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return ['compress arguments must be an object']
  }
  const record = args as Record<string, unknown>
  if (typeof record.topic !== 'string' || record.topic.length === 0) {
    errors.push('topic must be a non-empty string')
  } else if (record.topic.length > 200) {
    errors.push('topic must be at most 200 characters')
  }
  if (!Array.isArray(record.content) || record.content.length === 0) {
    errors.push('content must be a non-empty array')
    return errors
  }
  if (record.content.length > maxRanges) {
    errors.push(`content accepts at most ${maxRanges} range(s)`)
  }
  for (const [index, entry] of record.content.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`content[${index}] must be an object`)
      continue
    }
    const range = entry as Record<string, unknown>
    if (
      typeof range.startRef !== 'string' ||
      range.startRef.length === 0 ||
      range.startRef.length > 32
    ) {
      errors.push(`content[${index}].startRef must be a non-empty string (<= 32 chars)`)
    }
    if (
      typeof range.endRef !== 'string' ||
      range.endRef.length === 0 ||
      range.endRef.length > 32
    ) {
      errors.push(`content[${index}].endRef must be a non-empty string (<= 32 chars)`)
    }
    if (typeof range.summary !== 'string' || range.summary.length === 0) {
      errors.push(`content[${index}].summary must be a non-empty string`)
    } else if (range.summary.length > 8000) {
      errors.push(`content[${index}].summary must be at most 8000 characters`)
    } else {
      const summary = range.summary.trim()
      if (/^\[b\d+\]/.test(summary)) {
        errors.push(`content[${index}].summary must not start with a blockRef marker like [b1]`)
      } else if (/^<dcp-(?:inline-cleanup|cleanup|archived|rejected)\b/i.test(summary)) {
        errors.push(
          `content[${index}].summary must contain technical content, not a cleanup marker`,
        )
      } else if (/^\[stored\s+in\s+b(?:\d+|n)\]/i.test(summary)) {
        errors.push(
          `content[${index}].summary must contain technical content, not a stored pointer`,
        )
      }
    }
  }
  return errors
}
