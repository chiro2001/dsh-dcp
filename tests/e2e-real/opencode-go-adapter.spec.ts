import { describe, expect, it } from 'vitest'
import { parseXmlToolCalls } from './opencode-go-adapter.js'

describe('opencode-go XML tool-call parser', () => {
  it('parses nested content[] invocations', () => {
    const content =
      'I will compress.\n' +
      '<invoke name="compress">' +
      '<parameter name="topic">first turn</parameter>' +
      '<parameter name="content">' +
      '<item><parameter name="startRef">m0001</parameter></item>' +
      '<item><parameter name="startRef">m0002</parameter><parameter name="endRef">m0003</parameter></item>' +
      '</parameter>' +
      '</invoke>'
    const parsed = parseXmlToolCalls(content, () => 'call_x')
    expect(parsed.text).not.toContain('<invoke')
    expect(parsed.calls).toHaveLength(1)
    const args = JSON.parse(parsed.calls[0]!.arguments) as {
      topic: string
      content: Array<{ startRef: string; endRef?: string }>
    }
    expect(args.topic).toBe('first turn')
    expect(args.content).toEqual([
      { startRef: 'm0001' },
      { startRef: 'm0002', endRef: 'm0003' },
    ])
  })

  it('assigns unique call ids across responses', () => {
    let counter = 0
    const invocation =
      '<invoke name="read"><parameter name="filePath">a.txt</parameter></invoke>'
    const first = parseXmlToolCalls(invocation, () => `call_${counter++}`)
    const second = parseXmlToolCalls(invocation, () => `call_${counter++}`)
    expect(first.calls[0]!.id).toBe('call_0')
    expect(second.calls[0]!.id).toBe('call_1')
  })

  it('escapes nothing and leaves plain text intact', () => {
    const parsed = parseXmlToolCalls('no invocation here', () => 'call_0')
    expect(parsed.calls).toEqual([])
    expect(parsed.text).toBe('no invocation here')
  })
})
