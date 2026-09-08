/**
 * Minimal real LLM adapter for the opencode go gateway
 * (https://opencode.ai/zen/go/v1). Test-only: non-streaming chat.completions
 * with full-response chunk replay, enough to drive the real dsh agent loop.
 */

import {
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

export interface OpenCodeGoAdapterConfig {
  baseUrl: string
  apiKey: string
  model: string
}

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiMessage {
  role: string
  content?: string
  tool_call_id?: string
  tool_calls?: OpenAiToolCall[]
}

interface ParsedToolInvocation {
  id: string
  name: string
  arguments: string
}

export interface OpenCodeGoRequestDiagnostic {
  model: string
  messageCount: number
  messageRoles: string[]
  toolNames: string[]
  hasCompressTool: boolean
  hasCompressSchema: boolean
}

export interface OpenCodeGoResponseDiagnostic {
  httpStatus: number
  finishReason: string | undefined
  contentLength: number
  xmlToolNames: string[]
  channelToolNames: string[]
  errorMessage?: string
}

function diagnosticErrorMessage(detail: string): string | undefined {
  let message: unknown
  try {
    const parsed: unknown = JSON.parse(detail)
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const error = parsed.error
      if (typeof error === 'object' && error !== null && 'message' in error) {
        message = error.message
      }
    }
    if (
      message === undefined &&
      typeof parsed === 'object' &&
      parsed !== null &&
      'message' in parsed
    ) {
      message = parsed.message
    }
  } catch {
    // Keep a bounded, redacted prefix for non-JSON gateway errors.
    message = detail.slice(0, 200)
  }
  if (typeof message !== 'string') return undefined
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
    .replace(/(?:api[_-]?key|token|secret)["'=: ]+\S+/gi, '<credential-redacted>')
    .slice(0, 200)
}

function extractItems(value: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = []
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null
  while ((match = itemRe.exec(value)) !== null) {
    items.push(extractParameters(match[1]!) as Record<string, string>)
  }
  return items
}

/** Extract `<parameter name="...">` values, respecting nested parameters. */
function extractParameters(body: string): Record<string, unknown> {
  const parameters: Record<string, unknown> = {}
  const openRe = /<parameter name="([^"]+)">/g
  let open: RegExpExecArray | null
  while ((open = openRe.exec(body)) !== null) {
    const name = open[1]!
    const closeRe = /<\/parameter>|<parameter name="/g
    closeRe.lastIndex = openRe.lastIndex
    let depth = 1
    let end = -1
    let close: RegExpExecArray | null
    while ((close = closeRe.exec(body)) !== null) {
      if (close[0] === '<parameter name="') {
        depth++
      } else {
        depth--
        if (depth === 0) {
          end = close.index
          break
        }
      }
    }
    if (end === -1) continue
    const value = body.slice(openRe.lastIndex, end)
    if (name === 'content') {
      const items = extractItems(value)
      parameters[name] = items.length > 0 ? items : value.trim()
    } else {
      parameters[name] = value.trim()
    }
    openRe.lastIndex = end + '</parameter>'.length
  }
  return parameters
}

/**
 * The opencode go gateway's deepseek-v4-flash returns tool calls as inline
 * XML text (`<invoke name="...">`) instead of the OpenAI tool_calls channel.
 * Parse them back into real tool-call blocks.
 */
export function parseXmlToolCalls(
  content: string,
  nextId: () => string,
): { text: string; calls: ParsedToolInvocation[] } {
  const calls: ParsedToolInvocation[] = []
  const invocationRe = /<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/g
  let cleaned = content
  let match: RegExpExecArray | null
  while ((match = invocationRe.exec(content)) !== null) {
    const name = match[1]!
    const body = match[2]!
    cleaned = cleaned.replace(match[0], '')
    const parameters = extractParameters(body)
    calls.push({
      id: nextId(),
      name,
      arguments: JSON.stringify(parameters),
    })
  }
  return { text: cleaned.trim(), calls }
}

function toOpenAiMessages(options: GenerateOptions): OpenAiMessage[] {
  const messages: OpenAiMessage[] = []
  if (options.system) messages.push({ role: 'system', content: options.system })
  for (const message of options.messages) {
    if (message.role === 'user') {
      const toolResult = message.content.find((block) => block.type === 'tool-result')
      if (toolResult?.type === 'tool-result') {
        const text = toolResult.content
          .filter((block) => block.type === 'text')
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('\n')
        messages.push({
          role: 'tool',
          tool_call_id: String(toolResult.toolCallId),
          content: text || '[empty tool result]',
        })
        continue
      }
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
      messages.push({ role: 'user', content: text })
    } else if (message.role === 'assistant') {
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
      const toolCalls = message.content
        .filter((block) => block.type === 'tool-call')
        .map((block) => ({
          id: String(block.id),
          type: 'function' as const,
          function: { name: block.name, arguments: block.arguments },
        }))
      messages.push({
        role: 'assistant',
        ...(text ? { content: text } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    }
  }
  return messages
}

export class OpenCodeGoAdapter extends LlmAdapter {
  private callCounter = 0
  readonly requestDiagnostics: OpenCodeGoRequestDiagnostic[] = []
  readonly responseDiagnostics: OpenCodeGoResponseDiagnostic[] = []

  constructor(private readonly config: OpenCodeGoAdapterConfig) {
    super()
  }

  providerInfo(provider: string) {
    return { id: provider, name: 'opencode-go' }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const messages = toOpenAiMessages(options)
    const toolNames = (options.tools ?? []).map((tool) => tool.name)
    const compressSchema = options.tools?.find((tool) => tool.name === 'compress')
    this.requestDiagnostics.push({
      model: options.model,
      messageCount: messages.length,
      messageRoles: messages.map((message) => message.role),
      toolNames,
      hasCompressTool: toolNames.includes('compress'),
      hasCompressSchema:
        compressSchema !== undefined &&
        typeof compressSchema.parameters === 'object' &&
        compressSchema.parameters !== null,
    })

    const requestBody = {
      model: options.model,
      messages,
      ...(options.tools && options.tools.length > 0
        ? {
            tool_choice: 'auto',
            tools: options.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    }
    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(options.sessionId === undefined
            ? {}
            : { 'x-opencode-session': String(options.sessionId) }),
        },
        body: JSON.stringify(requestBody),
        signal: options.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      yield {
        type: 'finish',
        reason: {
          kind: 'aborted',
          failure: { message, code: 'ABORTED' },
        },
      }
      return
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      this.responseDiagnostics.push({
        httpStatus: response.status,
        finishReason: undefined,
        contentLength: 0,
        xmlToolNames: [],
        channelToolNames: [],
        errorMessage: diagnosticErrorMessage(detail),
      })
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            message: `opencode go HTTP ${response.status}`,
            code: 'HTTP_ERROR',
            status: response.status,
          },
        },
      }
      return
    }

    const data = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string
        message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }
      }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_cache_hit_tokens?: number
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    }
    const choice = data.choices?.[0]
    if (!choice) {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: 'empty completion', code: 'EMPTY' } },
      }
      return
    }

    const rawContent = choice.message?.content ?? ''
    const parsed = parseXmlToolCalls(rawContent, () => `call_${this.callCounter++}`)
    const channelToolNames = (choice.message?.tool_calls ?? []).map((toolCall) =>
      String(toolCall.function?.name ?? ''),
    )
    this.responseDiagnostics.push({
      httpStatus: response.status,
      finishReason: choice.finish_reason,
      contentLength: rawContent.length,
      xmlToolNames: parsed.calls.map((call) => call.name),
      channelToolNames,
    })
    const content = parsed.text
    if (content.length > 0) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: content }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: content } }
    }

    const channelToolCalls = (choice.message?.tool_calls ?? []).map((toolCall) => ({
      id: String(toolCall.id),
      name: String(toolCall.function?.name ?? ''),
      arguments: String(toolCall.function?.arguments ?? '{}'),
    }))
    const toolCalls = channelToolCalls.length > 0 ? channelToolCalls : parsed.calls
    for (const [index, toolCall] of toolCalls.entries()) {
      const id = toolCall.id
      const name = toolCall.name
      const argumentsText = toolCall.arguments
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index,
        id: ToolCallId(id),
        name,
        argumentsDelta: argumentsText,
      }
      yield {
        type: 'block-end',
        index,
        block: { type: 'tool-call', id: ToolCallId(id), name, arguments: argumentsText },
      }
    }

    const usageData = data.usage
    const usage: TokenUsage = {
      inputTokens: usageData?.prompt_tokens ?? 0,
      outputTokens: usageData?.completion_tokens ?? 0,
      ...(usageData?.prompt_cache_hit_tokens
        ? { cacheReadTokens: usageData.prompt_cache_hit_tokens }
        : {}),
      ...(usageData?.completion_tokens_details?.reasoning_tokens
        ? { reasoningTokens: usageData.completion_tokens_details.reasoning_tokens }
        : {}),
    }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
