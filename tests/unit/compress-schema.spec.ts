import { describe, expect, it } from 'vitest'
import {
  classifyCompressError,
  classifyCompressToolFailure,
  correctionForCompressFailure,
  validateCompressArgs,
} from '../../src/compress/schema.js'

describe('compress schema validation (M5 coverage)', () => {
  const messages = (args: unknown, max = 3) => validateCompressArgs(args, max).join('\n')

  it('accepts a valid single range and rejects malformed inputs', () => {
    expect(
      validateCompressArgs(
        { topic: 't', content: [{ startRef: 'm0001', endRef: 'm0002', summary: 's' }] },
        3,
      ),
    ).toEqual([])
    expect(validateCompressArgs(null, 3)).toHaveLength(1)
    expect(
      messages({ topic: '', content: [{ startRef: 'm1', endRef: 'm2', summary: 's' }] }, 3),
    ).toContain('topic must be a non-empty string')
    expect(
      messages(
        { topic: 'x'.repeat(201), content: [{ startRef: 'm1', endRef: 'm2', summary: 's' }] },
        3,
      ),
    ).toContain('topic must be at most 200 characters')
    expect(messages({ topic: 't', content: [] }, 3)).toContain(
      'content must be a non-empty array',
    )
    expect(
      messages(
        {
          topic: 't',
          content: [
            { startRef: 'm1', endRef: 'm2', summary: 's' },
            { startRef: 'm2', endRef: 'm3', summary: 's' },
            { startRef: 'm3', endRef: 'm4', summary: 's' },
            { startRef: 'm4', endRef: 'm5', summary: 's' },
          ],
        },
        3,
      ),
    ).toContain('content accepts at most 3 range(s)')
    expect(messages({ topic: 't', content: ['bad'] }, 3)).toContain(
      'content[0] must be an object',
    )
    expect(
      messages({ topic: 't', content: [{ startRef: '', endRef: 'm2', summary: 's' }] }, 3),
    ).toContain('startRef must be a non-empty string (<= 32 chars)')
    expect(
      messages({ topic: 't', content: [{ startRef: 'm1', endRef: 'm2', summary: '' }] }, 3),
    ).toContain('summary must be a non-empty string')
    expect(
      messages(
        { topic: 't', content: [{ startRef: 'm1', endRef: 'm2', summary: 'x'.repeat(8001) }] },
        3,
      ),
    ).toContain('summary must be at most 8000 characters')
  })

  it('rejects summaries that start with a blockRef marker', () => {
    expect(
      messages(
        { topic: 't', content: [{ startRef: 'm1', endRef: 'm2', summary: '[b1] summary' }] },
        3,
      ),
    ).toContain('content[0].summary must not start with a blockRef marker like [b1]')
    expect(
      messages(
        { topic: 't', content: [{ startRef: 'm1', endRef: 'm2', summary: '[b12]summary' }] },
        3,
      ),
    ).toContain('content[0].summary must not start with a blockRef marker like [b1]')
  })

  it('accepts summaries that merely mention blockRef markers later in the text', () => {
    expect(
      validateCompressArgs(
        { topic: 't', content: [{ startRef: 'm1', endRef: 'm2', summary: 'see [b1] above' }] },
        3,
      ),
    ).toEqual([])
  })

  it('rejects plugin cleanup markers and legacy stored pointers as summaries', () => {
    const fakeCleanup =
      '<dcp-inline-cleanup provenance="dsh-dcp" status="committed" block-ref="b999" />'
    expect(
      messages({
        topic: 't',
        content: [{ startRef: 'm1', endRef: 'm2', summary: fakeCleanup }],
      }),
    ).toContain('summary must contain technical content, not a cleanup marker')
    expect(
      messages({
        topic: 't',
        content: [
          {
            startRef: 'm1',
            endRef: 'm2',
            summary: '<dcp-inline-cleanup arbitrary="very-long" /> actual text',
          },
        ],
      }),
    ).toContain('summary must contain technical content, not a cleanup marker')
    expect(
      messages({
        topic: 't',
        content: [{ startRef: 'm1', endRef: 'm2', summary: '[stored in b999] actual text' }],
      }),
    ).toContain('summary must contain technical content, not a stored pointer')
  })

  it.each([
    '<dcp-cleanup provenance="dsh-dcp" expected="true" status="success">record</dcp-cleanup>',
    '<dcp-archived in b1; submitted_chars=42; stored_chars=42; verbatim=true>',
    '<dcp-rejected; code=INVALID_ARGS; body_removed=true>',
  ])('rejects a summary that starts with the %s cleanup pointer', (summary) => {
    expect(
      messages({ topic: 't', content: [{ startRef: 'm1', endRef: 'm2', summary }] }),
    ).toContain('summary must contain technical content, not a cleanup marker')
  })

  it('allows technical prose that mentions reserved markers in the middle', () => {
    const summary =
      'The protocol records <dcp-inline-cleanup status="committed" block-ref="b1" /> ' +
      'and [stored in b1] only as historical metadata.'
    expect(
      validateCompressArgs(
        { topic: 't', content: [{ startRef: 'm1', endRef: 'm2', summary }] },
        3,
      ),
    ).toEqual([])
    expect(
      validateCompressArgs(
        {
          topic: 't',
          content: [
            {
              startRef: 'm1',
              endRef: 'm2',
              summary: '```xml\n<dcp-inline-cleanup status="committed" />\n```',
            },
          ],
        },
        3,
      ),
    ).toEqual([])
  })

  it('classifies implementation failures into stable retry codes', () => {
    expect(classifyCompressError(new Error('startRef m0001 is not an active boundary'))).toBe(
      'STALE_REF',
    )
    expect(classifyCompressError(new Error('range enters the last 2 turn(s)'))).toBe(
      'RECENT_RANGE',
    )
    expect(
      classifyCompressError(new Error('range saves ~12 tokens below minNetSavingsTokens')),
    ).toBe('INSUFFICIENT_SAVINGS')
    expect(classifyCompressError(new Error('compaction is busy'))).toBe('BUSY')
    expect(correctionForCompressFailure('STALE_REF')).toBe(
      'refresh refs from the current context and retry',
    )
    expect(
      classifyCompressToolFailure({
        message: 'tool timed out',
        info: { code: 'TIMEOUT' },
      }),
    ).toBe('TIMEOUT')
    expect(classifyCompressError(new Error('request aborted after timeout deadline'))).toBe(
      'TIMEOUT',
    )
    expect(
      classifyCompressToolFailure({
        message: 'request aborted after timeout deadline',
        info: { code: 'TIMEOUT_ABORTED' },
      }),
    ).toBe('TIMEOUT')
    expect(
      classifyCompressToolFailure({
        message: 'guard denied compress',
      }),
    ).toBe('DENIED')
  })

  it('keeps short, actionable dynamic corrections without echoing the full error', () => {
    expect(
      correctionForCompressFailure(
        'RECENT_RANGE',
        'range m0001..m0005 enters retained turns [latestEligibleEndRef=m0004]',
      ),
    ).toContain('endRef at or before m0004')
    expect(
      correctionForCompressFailure(
        'PROTECTED_RANGE',
        'range contains protected node [nextActiveBoundary=m0003]',
      ),
    ).toContain('startRef at or after m0003')
    expect(
      correctionForCompressFailure(
        'PROTECTED_RANGE',
        'range contains protected node [nextActiveBoundary=none]',
      ),
    ).toContain('skip this range')
    const rangeCorrection = correctionForCompressFailure('RANGE_ORDER')
    expect(rangeCorrection).toContain('ranges must not overlap')
    expect(rangeCorrection).toContain('each startRef appears before its endRef')
    expect(rangeCorrection).not.toContain('sort')
    expect(rangeCorrection).not.toContain('surface order')

    const savingsCorrection = correctionForCompressFailure(
      'INSUFFICIENT_SAVINGS',
      'range saves ~12 tokens below minNetSavingsTokens=256 [savingsGapTokens=244]',
    )
    expect(savingsCorrection).toContain('same facts')
    expect(savingsCorrection).toContain('244')
    expect(savingsCorrection).toContain('larger older range with the same topic')
    expect(savingsCorrection).toContain('otherwise skip')
    expect(savingsCorrection).not.toContain('below minNetSavingsTokens')
    const boundedCorrection = correctionForCompressFailure(
      'INSUFFICIENT_SAVINGS',
      `${'details '.repeat(2000)} [savingsGapTokens=244]`,
    )
    expect(boundedCorrection.length).toBeLessThan(240)
    expect(boundedCorrection).not.toContain('details')
  })
})
