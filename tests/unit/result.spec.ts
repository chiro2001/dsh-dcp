import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { formatCompressFailure, formatCompressResult } from '../../src/compress/result.js'

describe('formatCompressResult (inline-cleanup clarity)', () => {
  const block = (blockRef: string) => ({
    blockRef,
    checkpointSeq: SessionSeq(1),
    compressedMessages: 6,
    compressedTokens: 123,
  })

  it('explains that full summaries are stored in checkpoints after a clean compress', () => {
    const text = formatCompressResult({
      blocks: [block('b1'), block('b2')],
      failed: [],
      cleanupWarning: undefined,
    })
    expect(text).toContain('Compressed 12 message(s) into b1, b2.')
    expect(text).toContain('status=success')
    expect(text).toContain('committed=b1,b2')
    expect(text).toContain('rejected=none')
    expect(text).toContain('correction=STOP')
    expect(text).toContain('plugin rewrote the historical tool call after commit')
    expect(text).not.toContain('[stored in bN]')
  })

  it('does not add the clarity note when cleanup was not performed cleanly', () => {
    const text = formatCompressResult({
      blocks: [block('b1')],
      failed: [],
      cleanupWarning: 'no inline summary argument found to clean',
    })
    expect(text).toContain('Compressed 6 message(s) into b1.')
    expect(text).toContain('status=success')
    expect(text).toContain('cleanup warning')
    expect(text).toContain('cleanup=not-confirmed')
    expect(text).not.toContain('plugin rewrote the historical tool call after commit')
  })

  it('still reports failed ranges alongside successful blocks', () => {
    const text = formatCompressResult({
      blocks: [block('b1')],
      failed: [{ startRef: 'm0003', endRef: 'm0004', error: 'range enters last turn(s)' }],
      cleanupWarning: undefined,
    })
    expect(text).toContain('Compressed 6 message(s) into b1.')
    expect(text).toContain('status=partial')
    expect(text).toContain('committed=b1')
    expect(text).toContain('rejected=m0003..m0004[RECENT_RANGE]')
    expect(text).toContain('correction=HANDLE ONLY the rejected ranges as directed')
  })

  it('does not claim partial cleanup succeeded when it has a warning', () => {
    const text = formatCompressResult({
      status: 'partial',
      blocks: [block('b1')],
      failed: [{ startRef: 'm0003', endRef: 'm0004', error: 'range failed' }],
      cleanupWarning: 'inline cleanup failed: append unavailable',
    })
    expect(text).toContain('status=partial')
    expect(text).toContain('committed=b1')
    expect(text).toContain('cleanup=not-confirmed')
    expect(text).not.toContain('plugin rewrote the historical tool call after commit')
  })

  it('keeps partial results neutral when a failed range should be skipped', () => {
    const text = formatCompressResult({
      status: 'partial',
      blocks: [block('b1')],
      failed: [
        {
          index: 1,
          startRef: 'm0003',
          endRef: 'm0004',
          code: 'RECENT_RANGE',
          error: 'range is retained',
          correction: 'skip this range; no eligible endRef remains outside retained turns',
        },
      ],
    })
    expect(text).toContain('correction=HANDLE ONLY the rejected ranges as directed')
    expect(text).toContain('details=skip this range')
    expect(text).not.toContain('RETRY ONLY')
    expect(text).toContain('do not retry committed ranges')
  })

  it('returns a rejected status with machine-stable correction fields', () => {
    const text = formatCompressResult({
      status: 'rejected',
      blocks: [],
      failed: [
        {
          index: 0,
          startRef: 'm0001',
          endRef: 'm0003',
          code: 'STALE_REF',
          error: 'startRef m0001 is not an active boundary',
          correction: 'refresh refs from the current context',
        },
      ],
    })
    expect(text).toBe(
      'Compression committed no ranges. status=rejected; committed=none; ' +
        'rejected=m0001..m0003[STALE_REF]; correction=refresh refs from the current context. ' +
        'No range was committed; follow the correction exactly.',
    )
  })

  it('does not turn a skip correction into a contradictory retry instruction', () => {
    const text = formatCompressResult({
      status: 'rejected',
      blocks: [],
      failed: [
        {
          index: 0,
          startRef: 'm0001',
          endRef: 'm0002',
          code: 'RECENT_RANGE',
          error: 'no eligible boundary remains',
          correction: 'skip this range; no eligible endRef remains outside retained turns',
        },
      ],
    })
    expect(text).toContain('correction=skip this range')
    expect(text).toContain('follow the correction exactly')
    expect(text).not.toContain('correct the rejected ranges and retry')
  })

  it('formats pre-execute failures without copying the rejected summary', () => {
    const longSummary = 'x'.repeat(4121)
    const text = formatCompressFailure(
      {
        topic: 't',
        content: [{ startRef: 'm0001', endRef: 'm0002', summary: longSummary }],
      },
      new Error('invalid arguments: content[0].extra is not allowed'),
      'INVALID_ARGS',
    )
    expect(text).toContain('status=rejected')
    expect(text).toContain('[INVALID_ARGS]')
    expect(text).not.toContain(longSummary)
  })

  it('keeps a stable code and correction for call-level invalid arguments', () => {
    const longPayload = 'x'.repeat(4121)
    const text = formatCompressFailure(
      { topic: 't', content: longPayload },
      new Error('invalid arguments: content must be an array'),
      'INVALID_ARGS',
    )
    expect(text).toContain('status=rejected')
    expect(text).toContain('rejected=?..?[INVALID_ARGS]')
    expect(text).toContain('fix the compress schema')
    expect(text).not.toContain(longPayload)
  })
})
