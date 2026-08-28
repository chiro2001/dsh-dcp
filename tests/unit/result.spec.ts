import { describe, expect, it } from 'vitest'
import { formatCompressResult } from '../../src/compress/result.js'

describe('formatCompressResult (inline-cleanup clarity)', () => {
  const block = (blockRef: string) => ({
    blockRef,
    checkpointSeq: 1,
    compressedMessages: 6,
    compressedTokens: 123,
  })

  it('explains that full summaries are stored in checkpoints after a clean compress', () => {
    const text = formatCompressResult({
      blocks: [block('b1'), block('b2')],
      failed: [],
      cleanupWarning: undefined,
    })
    expect(text).toBe(
      'Compressed 12 message(s) into b1, b2.' +
        ' Full summaries are stored in the new checkpoints; any [stored in bN] in the inline tool-call arguments is only the cleanup marker, not the stored summary.',
    )
    expect(text).toContain('Full summaries are stored')
    expect(text).toContain('[stored in bN]')
  })

  it('does not add the clarity note when cleanup was not performed cleanly', () => {
    const text = formatCompressResult({
      blocks: [block('b1')],
      failed: [],
      cleanupWarning: 'no inline summary argument found to clean',
    })
    expect(text).toContain('Compressed 6 message(s) into b1.')
    expect(text).toContain('cleanup warning')
    expect(text).not.toContain('Full summaries are stored')
  })

  it('still reports failed ranges alongside successful blocks', () => {
    const text = formatCompressResult({
      blocks: [block('b1')],
      failed: [{ startRef: 'm0003', endRef: 'm0004', error: 'range enters last turn(s)' }],
      cleanupWarning: undefined,
    })
    expect(text).toContain('Compressed 6 message(s) into b1.')
    expect(text).toContain('1 range(s) failed: m0003..m0004: range enters last turn(s)')
  })
})
