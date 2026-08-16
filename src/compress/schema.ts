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
    }
  }
  return errors
}
