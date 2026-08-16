import { describe, expect, it } from 'vitest'
import {
  controlMessage,
  isDcpControlMessage,
  parseControl,
} from '../../src/strategies/control.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'

describe('control messages (M3)', () => {
  it('recognizes dcp control messages and ignores normal user messages', () => {
    expect(isDcpControlMessage(controlMessage('sweep'))).toBe(true)
    const normal = createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    })
    expect(isDcpControlMessage(normal)).toBe(false)
  })

  it('parses sweep, expand, and recompress control payloads', () => {
    expect(parseControl(controlMessage('sweep'))).toEqual({ kind: 'sweep' })
    expect(parseControl(controlMessage('expand b1'))).toEqual({ kind: 'expand', arg: 'b1' })
    expect(parseControl(controlMessage('recompress b2'))).toEqual({
      kind: 'recompress',
      arg: 'b2',
    })
    expect(parseControl(controlMessage('unknown'))).toBeUndefined()
  })
})
