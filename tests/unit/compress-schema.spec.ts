import { describe, expect, it } from 'vitest'
import { validateCompressArgs } from '../../src/compress/schema.js'

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
})
