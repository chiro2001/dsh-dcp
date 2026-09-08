import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { OpenCodeGoAdapter, parseXmlToolCalls } from './opencode-go-adapter.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

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

  it('routes each request with the AgentLoop session header', async () => {
    let requestHeaders: Headers | undefined
    globalThis.fetch = async (_input, init) => {
      requestHeaders = new Headers(init?.headers)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const adapter = new OpenCodeGoAdapter({
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-only-redacted-key',
      model: 'deepseek-v4-flash',
    })
    const options = {
      provider: 'go',
      model: 'deepseek-v4-flash',
      messages: [],
      sessionId: SessionId('session-header-test'),
    }
    let lastChunkType: string | undefined
    for await (const chunk of adapter.stream(options)) lastChunkType = chunk.type

    expect(requestHeaders?.get('x-opencode-session')).toBe('session-header-test')
    expect(lastChunkType).toBe('finish')
  })
})
