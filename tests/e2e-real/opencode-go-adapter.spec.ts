import { afterEach, describe, expect, it } from 'vitest'
import {
  createAssistantMessage,
  createDeveloperMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-tools'
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

  it('routes each request to the configured chat-completions endpoint', async () => {
    let requestUrl: string | undefined
    let authorization: string | null | undefined
    let requestHeaders: Headers | undefined
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input)
      requestHeaders = new Headers(init?.headers)
      authorization = requestHeaders.get('authorization')
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const adapter = new OpenCodeGoAdapter({
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-only-redacted-key',
    })
    const options = {
      provider: 'go',
      model: 'deepseek-v4-flash',
      messages: [],
    }
    let lastChunkType: string | undefined
    let finishReason: string | undefined
    for await (const chunk of adapter.stream(options)) {
      lastChunkType = chunk.type
      if (chunk.type === 'finish') finishReason = chunk.reason.kind
    }

    expect(requestUrl).toBe('https://example.invalid/v1/chat/completions')
    expect(authorization).toBe('Bearer test-only-redacted-key')
    expect(requestHeaders?.has('x-opencode-session')).toBe(false)
    expect(lastChunkType).toBe('finish')
    expect(finishReason).toBe('stop')
  })

  it('serializes logged system, developer, and tool messages with flat tool results', async () => {
    let requestBody: { messages?: Array<Record<string, unknown>> } | undefined
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as {
        messages?: Array<Record<string, unknown>>
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const callId = ToolCallId('call-from-source')
    const adapter = new OpenCodeGoAdapter({
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-only-redacted-key',
      model: 'deepseek-v4-flash',
    })
    const options = {
      provider: 'go',
      model: 'deepseek-v4-flash',
      messages: [
        createSystemMessage('system prompt from the session log'),
        createDeveloperMessage({
          source: { kind: 'tool-registry' },
          content: [
            { type: 'tool-addition', toolName: 'compress' },
            { type: 'tool-removal', toolName: 'obsolete' },
          ],
        }),
        createUserMessage({
          content: [{ type: 'text', text: 'Please compress the first turn.' }],
          source: { kind: 'user' },
        }),
        createAssistantMessage({
          source: { provider: 'go', model: 'deepseek-v4-flash' },
          content: [
            { type: 'reasoning', text: 'previous reasoning' },
            {
              type: 'tool-call',
              id: callId,
              name: 'compress',
              arguments:
                '{"topic":"first","content":[{"startRef":"m0001","endRef":"m0002","summary":"fact"}]}',
            },
          ],
        }),
        createToolResultMessage({
          callId,
          content: [
            { type: 'text', text: 'status=success' },
            { type: 'text', text: 'committed=b1' },
          ],
          isError: false,
        }),
        createUserMessage({
          content: [
            { type: 'text', text: '<dcp-cleanup provenance="dsh-dcp" status="success">' },
          ],
          source: { kind: 'dsh-dcp' },
        }),
      ],
    }
    let lastChunkType: string | undefined
    for await (const chunk of adapter.stream(options)) lastChunkType = chunk.type

    expect(lastChunkType).toBe('finish')
    expect(requestBody?.messages).toEqual([
      { role: 'system', content: 'system prompt from the session log' },
      { role: 'developer', content: 'Tool added: compress\nTool removed: obsolete' },
      { role: 'user', content: 'Please compress the first turn.' },
      {
        role: 'assistant',
        reasoning_content: 'previous reasoning',
        tool_calls: [
          {
            id: 'call-from-source',
            type: 'function',
            function: {
              name: 'compress',
              arguments:
                '{"topic":"first","content":[{"startRef":"m0001","endRef":"m0002","summary":"fact"}]}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call-from-source',
        content: 'status=success\ncommitted=b1',
      },
      {
        role: 'user',
        content: '<dcp-cleanup provenance="dsh-dcp" status="success">',
      },
    ])
    expect(adapter.requestDiagnostics[0]?.hasDcpCleanupMessage).toBe(true)
    expect(adapter.requestDiagnostics[0]?.toolResultCallIds).toEqual(['call-from-source'])
    expect(adapter.requestDiagnostics[0]?.compressRanges).toEqual([
      { startRef: 'm0001', endRef: 'm0002' },
    ])
  })

  it('sends the configured model and disabled-thinking option to DeepSeek', async () => {
    let requestBody: Record<string, unknown> | undefined
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const adapter = new OpenCodeGoAdapter({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-only-redacted-key',
      model: 'deepseek-flash',
      thinking: 'disabled',
    })
    let finishKind: string | undefined
    for await (const chunk of adapter.stream({
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })) {
      if (chunk.type === 'finish') finishKind = chunk.reason.kind
    }

    expect(finishKind).toBe('stop')
    expect(requestBody).toMatchObject({
      model: 'deepseek-flash',
      thinking: { type: 'disabled' },
      messages: [],
    })
  })

  it('preserves reasoning and uses unique indexes while mapping the provider finish reason', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                reasoning_content: 'short internal reasoning',
                content: 'Calling both tools.',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'compress', arguments: '{"topic":"one"}' },
                  },
                  {
                    id: 'call_2',
                    type: 'function',
                    function: { name: 'compress', arguments: '{"topic":"two"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {
            prompt_tokens: 10,
            prompt_cache_hit_tokens: 2,
            completion_tokens: 4,
            completion_tokens_details: { reasoning_tokens: 1 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )

    const adapter = new OpenCodeGoAdapter({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-only-redacted-key',
      model: 'deepseek-flash',
    })
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })) {
      chunks.push(chunk)
    }

    const blockStarts = chunks.filter((chunk) => chunk.type === 'block-start')
    expect(blockStarts).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'block-start', index: 2, blockType: 'tool-call' },
      { type: 'block-start', index: 3, blockType: 'tool-call' },
    ])
    expect(chunks).toContainEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'reasoning', text: 'short internal reasoning' },
    })
    expect(chunks).toContainEqual({
      type: 'finish',
      reason: { kind: 'tool-calls' },
    })
    expect(adapter.responseDiagnostics[0]?.usage).toEqual({
      inputTokens: 8,
      outputTokens: 4,
      cacheReadTokens: 2,
      reasoningTokens: 1,
    })
    const allBlockIndexes = chunks
      .filter((chunk) => chunk.type !== 'usage' && chunk.type !== 'finish')
      .map((chunk) => chunk.index)
    expect(new Set(allBlockIndexes).size).toBe(4)
  })

  it('keeps XML compress text as text when the provider supplies no native tool calls', async () => {
    const invocation =
      '<invoke name="compress"><parameter name="topic">setup numbers</parameter>' +
      '<parameter name="content"><item><parameter name="startRef">m0001</parameter>' +
      '<parameter name="endRef">m0002</parameter><parameter name="summary">facts</parameter>' +
      '</item></parameter></invoke>'
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: invocation }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )

    const adapter = new OpenCodeGoAdapter({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-only-redacted-key',
      model: 'deepseek-flash',
    })
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })) {
      chunks.push(chunk)
    }

    expect(
      chunks
        .filter((chunk) => chunk.type === 'text-delta')
        .map((chunk) => (chunk.type === 'text-delta' ? chunk.text : ''))
        .join(''),
    ).toBe(invocation)
    expect(
      chunks.filter((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call'),
    ).toEqual([])
  })

  it('preserves XML body text when native calls are also present and executes only those calls', async () => {
    const xmlInvocation =
      '<invoke name="compress"><parameter name="topic">setup numbers</parameter>' +
      '<parameter name="content"><item><parameter name="startRef">m0001</parameter>' +
      '<parameter name="endRef">m0002</parameter><parameter name="summary">facts</parameter>' +
      '</item></parameter></invoke>'
    const responseText = `Native call first.\n${xmlInvocation}`
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: responseText,
                tool_calls: [
                  {
                    id: 'native-read',
                    type: 'function',
                    function: { name: 'read', arguments: '{"filePath":"README.md"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )

    const adapter = new OpenCodeGoAdapter({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-only-redacted-key',
      model: 'deepseek-flash',
    })
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })) {
      chunks.push(chunk)
    }

    expect(
      chunks
        .filter((chunk) => chunk.type === 'text-delta')
        .map((chunk) => (chunk.type === 'text-delta' ? chunk.text : ''))
        .join(''),
    ).toBe(responseText)
    const calls = chunks.filter(
      (chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call',
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      type: 'block-end',
      block: { type: 'tool-call', name: 'read' },
    })
  })

  it.each([
    ['length', 'max-tokens'],
    ['content_filter', 'error'],
  ] as const)('maps finish reason %s to %s', async (finishReason, expectedKind) => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'partial response' }, finish_reason: finishReason }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    const adapter = new OpenCodeGoAdapter({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-only-redacted-key',
      model: 'deepseek-flash',
    })
    let finish: Extract<StreamChunk, { type: 'finish' }> | undefined
    for await (const chunk of adapter.stream({
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })) {
      if (chunk.type === 'finish') finish = chunk
    }
    expect(finish?.reason.kind).toBe(expectedKind)
    if (finishReason === 'content_filter') {
      expect(finish?.reason).toMatchObject({
        kind: 'error',
        failure: { code: 'CONTENT_FILTER' },
      })
    }
  })

  it('redacts provider credentials from HTTP error diagnostics', async () => {
    const configuredApiKey = 'sk-configured-literal-secret'
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: `invalid api_key="sk-test-secret"; Bearer sk-bearer-secret; token=hidden-token; ${configuredApiKey}`,
          },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      )

    const adapter = new OpenCodeGoAdapter({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: configuredApiKey,
      model: 'deepseek-flash',
    })
    let finishKind: string | undefined
    for await (const chunk of adapter.stream({
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })) {
      if (chunk.type === 'finish') finishKind = chunk.reason.kind
    }

    expect(finishKind).toBe('error')
    const error = JSON.stringify(adapter.responseDiagnostics)
    expect(error).not.toContain('sk-test-secret')
    expect(error).not.toContain('sk-bearer-secret')
    expect(error).not.toContain('hidden-token')
    expect(error).not.toContain(configuredApiKey)
  })
})
