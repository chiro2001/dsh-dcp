import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { resolveConfig } from '../../src/config.js'
import { matchesGlob } from '../../src/protection/patterns.js'
import { collectProtectedAppendix } from '../../src/protection/classify.js'

describe('protected content (M5 coverage)', () => {
  it('matches glob patterns with **, *, ?, and windows separators', () => {
    expect(matchesGlob('src/a.ts', '**/*.ts')).toBe(true)
    expect(matchesGlob('src/deep/a.ts', '**/*.ts')).toBe(true)
    expect(matchesGlob('a.txt', '*.txt')).toBe(true)
    expect(matchesGlob('dir/a.txt', '*.txt')).toBe(false)
    expect(matchesGlob('file?.md', 'file?.md')).toBe(true)
    expect(matchesGlob('C:\\work\\a.txt', '**/a.txt')).toBe(true)
    expect(matchesGlob('a.ts', '**/*.txt')).toBe(false)
    expect(matchesGlob('x', '')).toBe(false)
  })

  it('collects user messages, protect tags, and protected sources', () => {
    const session = Session.create(SessionId('protect-appendix'))
    const u1 = session.append(
      'user/message',
      createUserMessage({
        content: [
          { type: 'text', text: 'plain user text' },
          { type: 'text', text: '<protect>secret token abc</protect>' },
        ],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    const u2 = session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'report content' }],
        source: { kind: 'plugin', plugin: 'subagent', form: 'notice', summary: 'report' },
      }),
      { surfaceOp: 'append' },
    )
    const config = resolveConfig({
      compress: {
        protectUserMessages: true,
        protectTags: true,
        protectedSources: ['notice'],
      },
    })
    const appendix = collectProtectedAppendix(session, [u1.seq, u2.seq], config)
    expect(appendix.text).toContain('plain user text')
    expect(appendix.text).toContain('secret token abc')
    expect(appendix.text).toContain('report content')
    expect(appendix.kinds).toEqual(
      expect.arrayContaining(['user', 'protect-tag', 'source:notice']),
    )
  })

  it('appends protected tool outputs', () => {
    const session = Session.create(SessionId('protect-tool'))
    const callId = CallId('p1')
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'read',
      arguments: '{"filePath":"a.txt"}',
    })
    const result = session.append(
      'tool/result',
      {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId,
          content: [{ type: 'text', text: 'sensitive file content' }],
          isError: false,
        }),
      },
      { surfaceOp: 'append' },
    )
    const config = resolveConfig({ protectedFilePatterns: ['**/*.txt'] })
    const appendix = collectProtectedAppendix(session, [result.seq], config)
    expect(appendix.text).toContain('Protected tool read output verbatim')
    expect(appendix.text).toContain('sensitive file content')
  })
})
