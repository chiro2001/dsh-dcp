import { describe, expect, it } from 'vitest'
import { controlMessage, isDcpControlMessage } from '../../src/strategies/control.js'
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
})
