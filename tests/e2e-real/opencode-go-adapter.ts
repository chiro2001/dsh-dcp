/**
 * Minimal real LLM adapter for DeepSeek-compatible chat completions. Test-only:
 * it replays one full response into dsh's indexed block stream.
 */

import {
  LlmAdapter,
  type ContentBlock,
  type FinishReason,
  type GenerateOptions,
  type StreamChunk,
  type TokenUsage,
  attributionHeaders,
  isContextWindowExceededError,
  CONTEXT_WINDOW_EXCEEDED_CODE,
} from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { createHash } from 'node:crypto'

export interface OpenCodeGoAdapterConfig {
  baseUrl: string
  apiKey: string
  /** Kept only for source compatibility; each request uses `options.model`. */
  model?: string
  thinking?: 'enabled' | 'disabled'
  /** Physical HTTP attempts, including errors. Synchronous observers fail closed. */
  onAttempt?: (event: OpenCodeGoAttemptEvent) => void
}

interface AttemptBase {
  requestId: number
  startedAt: number
  model: string
  sessionId?: string
  purpose?: string
}

export type OpenCodeGoAttemptEvent =
  | (AttemptBase & { phase: 'start'; requestHash: string })
  | (AttemptBase & {
      phase: 'finish'
      finishedAt: number
      status: 'success' | 'http_error' | 'network_error' | 'invalid_response' | 'aborted'
      httpStatus?: number
      providerCreated?: number
      providerModel?: string
      usage?: {
        uncachedInputTokens: number
        cacheReadTokens: number
        outputTokens: number
        reasoningTokens?: number
      }
    })

/** Only complete, consistent counters are suitable for billing. */
function billingUsage(
  data: unknown,
): Extract<OpenCodeGoAttemptEvent, { phase: 'finish' }>['usage'] {
  if (typeof data !== 'object' || data === null || !('usage' in data)) return undefined
  const usage = data.usage
  if (typeof usage !== 'object' || usage === null) return undefined
  const raw = usage as Record<string, unknown>
  const details = raw.prompt_tokens_details as { cached_tokens?: unknown } | undefined
  const cached = details?.cached_tokens ?? raw.prompt_cache_hit_tokens
  const prompt = raw.prompt_tokens
  const output = raw.completion_tokens
  const valid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (!valid(prompt) || !valid(cached) || !valid(output) || cached > prompt) return undefined
  const uncached = prompt - cached
  if (raw.prompt_cache_miss_tokens !== undefined && raw.prompt_cache_miss_tokens !== uncached)
    return undefined
  const outputDetails = raw.completion_tokens_details as
    { reasoning_tokens?: unknown } | undefined
  const reasoning = outputDetails?.reasoning_tokens
  if (reasoning !== undefined && (!valid(reasoning) || reasoning > output)) return undefined
  return {
    uncachedInputTokens: uncached,
    cacheReadTokens: cached,
    outputTokens: output,
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning as number }),
  }
}

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content?: string
  reasoning_content?: string
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
  thinking?: 'enabled' | 'disabled'
  messageCount: number
  messageRoles: string[]
  toolResultCallIds: string[]
  toolNames: string[]
  hasCompressTool: boolean
  hasCompressSchema: boolean
  hasDcpCleanupMessage: boolean
  compressRanges: Array<{ startRef: string; endRef: string }>
}

export interface OpenCodeGoResponseDiagnostic {
  httpStatus: number
  finishReason: string | undefined
  contentLength: number
  reasoningLength: number
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    reasoningTokens?: number
  }
  xmlToolNames: string[]
  channelToolNames: string[]
  errorMessage?: string
}

function diagnosticErrorMessage(detail: string, apiKey: string): string | undefined {
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
  const withSecretRemoved =
    apiKey.length > 0 ? message.replaceAll(apiKey, '<credential-redacted>') : message
  return withSecretRemoved
    .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
    .replace(/(?:api[_-]?key|token|secret)["'=: ]+\S+/gi, '<credential-redacted>')
    .replace(/\b(?:sk|ds)-[A-Za-z0-9_-]{8,}\b/g, '<credential-redacted>')
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
 * Legacy XML parser for offline fixtures and response diagnostics only.
 * Parsed invocations never execute; the adapter emits only native tool_calls.
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

function flattenText(content: readonly ContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

function developerText(content: readonly ContentBlock[]): string {
  return content
    .flatMap((block) => {
      if (block.type === 'text') return [block.text]
      if (block.type === 'tool-addition') return [`Tool added: ${block.toolName}`]
      if (block.type === 'tool-removal') return [`Tool removed: ${block.toolName}`]
      return []
    })
    .join('\n')
}

function toOpenAiMessages(options: GenerateOptions): OpenAiMessage[] {
  const messages: OpenAiMessage[] = []
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system })
  for (const message of options.messages) {
    if (message.role === 'system') {
      messages.push({ role: 'system', content: flattenText(message.content) })
    } else if (message.role === 'developer') {
      messages.push({ role: 'developer', content: developerText(message.content) })
    } else if (message.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: String(message.source.callId),
        content: flattenText(message.content) || '[empty tool result]',
      })
    } else if (message.role === 'user') {
      messages.push({
        role: 'user',
        content: flattenText(message.content),
      })
    } else if (message.role === 'assistant') {
      const text = flattenText(message.content)
      const reasoning = message.content
        .filter((block) => block.type === 'reasoning')
        .map((block) => (block.type === 'reasoning' ? block.text : ''))
        .join('')
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
        ...(toolCalls.length > 0 && reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    }
  }
  return messages
}

function compressRangesInHistory(
  messages: GenerateOptions['messages'],
): Array<{ startRef: string; endRef: string }> {
  const ranges: Array<{ startRef: string; endRef: string }> = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      if (block.type !== 'tool-call' || block.name !== 'compress') continue
      try {
        const args: unknown = JSON.parse(block.arguments)
        if (typeof args !== 'object' || args === null || !('content' in args)) continue
        const entries = args.content
        if (!Array.isArray(entries)) continue
        for (const entry of entries) {
          if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
          const startRef = 'startRef' in entry ? entry.startRef : undefined
          const endRef = 'endRef' in entry ? entry.endRef : undefined
          if (typeof startRef === 'string' && typeof endRef === 'string') {
            ranges.push({ startRef, endRef })
          }
        }
      } catch {
        // A malformed historical call has no usable range diagnostic.
      }
    }
  }
  return ranges
}

export class OpenCodeGoAdapter extends LlmAdapter {
  private callCounter = 0
  private requestCounter = 0
  readonly requestDiagnostics: OpenCodeGoRequestDiagnostic[] = []
  readonly responseDiagnostics: OpenCodeGoResponseDiagnostic[] = []

  constructor(private readonly config: OpenCodeGoAdapterConfig) {
    super()
  }

  providerInfo(provider: string) {
    return { id: provider, name: 'DeepSeek-compatible chat completions' }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const messages = toOpenAiMessages(options)
    const toolNames = (options.tools ?? []).map((tool) => tool.name)
    const compressSchema = options.tools?.find((tool) => tool.name === 'compress')
    this.requestDiagnostics.push({
      model: options.model,
      ...(this.config.thinking === undefined ? {} : { thinking: this.config.thinking }),
      messageCount: messages.length,
      messageRoles: messages.map((message) => message.role),
      toolResultCallIds: options.messages.flatMap((message) =>
        message.role === 'tool' ? [String(message.source.callId)] : [],
      ),
      toolNames,
      hasCompressTool: toolNames.includes('compress'),
      hasCompressSchema:
        compressSchema !== undefined &&
        typeof compressSchema.parameters === 'object' &&
        compressSchema.parameters !== null,
      hasDcpCleanupMessage: options.messages.some(
        (message) =>
          message.role === 'user' &&
          message.content.some(
            (block) => block.type === 'text' && block.text.includes('<dcp-cleanup'),
          ),
      ),
      compressRanges: compressRangesInHistory(options.messages),
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
      ...(this.config.thinking === undefined
        ? {}
        : { thinking: { type: this.config.thinking } }),
    }
    const body = JSON.stringify(requestBody)
    const attempt: AttemptBase = {
      requestId: ++this.requestCounter,
      startedAt: Date.now(),
      model: options.model,
      ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) }),
      ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
    }
    this.config.onAttempt?.({
      ...attempt,
      phase: 'start',
      requestHash: createHash('sha256').update(body, 'utf8').digest('hex'),
    })
    const finishAttempt = (
      status: Extract<OpenCodeGoAttemptEvent, { phase: 'finish' }>['status'],
      data?: unknown,
      httpStatus?: number,
    ) => {
      const usage = billingUsage(data)
      const envelope =
        typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
      this.config.onAttempt?.({
        ...attempt,
        phase: 'finish',
        finishedAt: Date.now(),
        status,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(typeof envelope.created === 'number' && Number.isSafeInteger(envelope.created)
          ? { providerCreated: envelope.created }
          : {}),
        ...(typeof envelope.model === 'string' ? { providerModel: envelope.model } : {}),
        ...(usage === undefined ? {} : { usage }),
      })
    }
    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          ...attributionHeaders(),
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body,
        signal: options.signal,
      })
    } catch (error) {
      finishAttempt(
        options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')
          ? 'aborted'
          : 'network_error',
      )
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
      const contextOverflow = isContextWindowExceededError(detail)
      let errorData: unknown
      try {
        errorData = JSON.parse(detail)
      } catch {
        // Non-JSON errors have no authoritative usage counters.
      }
      finishAttempt('http_error', errorData, response.status)
      this.responseDiagnostics.push({
        httpStatus: response.status,
        finishReason: undefined,
        contentLength: 0,
        reasoningLength: 0,
        xmlToolNames: [],
        channelToolNames: [],
        errorMessage: diagnosticErrorMessage(detail, this.config.apiKey),
      })
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            message: `chat completions HTTP ${response.status}`,
            code: contextOverflow ? CONTEXT_WINDOW_EXCEEDED_CODE : 'HTTP_ERROR',
            status: response.status,
          },
        },
      }
      return
    }

    let rawData: unknown
    try {
      rawData = await response.json()
    } catch {
      finishAttempt('invalid_response', undefined, response.status)
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'invalid JSON response', code: 'INVALID_JSON' },
        },
      }
      return
    }
    const data = (rawData ?? {}) as {
      choices?: Array<{
        finish_reason?: string
        message?: {
          content?: string | null
          reasoning_content?: string | null
          tool_calls?: OpenAiToolCall[]
        }
      }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_cache_hit_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    }
    const choice = data.choices?.[0]
    if (!choice) {
      finishAttempt('invalid_response', rawData, response.status)
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: 'empty completion', code: 'EMPTY' } },
      }
      return
    }
    finishAttempt('success', rawData, response.status)

    const rawContent = choice.message?.content ?? ''
    const reasoning = choice.message?.reasoning_content ?? ''
    const usageData = data.usage
    const cacheReadTokens =
      usageData?.prompt_tokens_details?.cached_tokens ?? usageData?.prompt_cache_hit_tokens
    const inputTokens = Math.max(0, (usageData?.prompt_tokens ?? 0) - (cacheReadTokens ?? 0))
    const outputTokens = usageData?.completion_tokens ?? 0
    const reasoningTokens = usageData?.completion_tokens_details?.reasoning_tokens
    const parsed = parseXmlToolCalls(rawContent, () => `call_${this.callCounter++}`)
    const channelToolNames = (choice.message?.tool_calls ?? []).map((toolCall) =>
      String(toolCall.function?.name ?? ''),
    )
    this.responseDiagnostics.push({
      httpStatus: response.status,
      finishReason: choice.finish_reason,
      contentLength: rawContent.length,
      reasoningLength: reasoning.length,
      ...(usageData === undefined
        ? {}
        : {
            usage: {
              inputTokens,
              outputTokens,
              ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
              ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
            },
          }),
      xmlToolNames: parsed.calls.map((call) => call.name),
      channelToolNames,
    })
    // XML in model prose is data, never an alternate execution channel.
    // Keep it verbatim so the session records the actual model response.
    const content = rawContent
    let nextBlockIndex = 0
    if (reasoning.length > 0) {
      const index = nextBlockIndex++
      yield { type: 'block-start', index, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index, text: reasoning }
      yield { type: 'block-end', index, block: { type: 'reasoning', text: reasoning } }
    }
    if (content.length > 0) {
      const index = nextBlockIndex++
      yield { type: 'block-start', index, blockType: 'text' }
      yield { type: 'text-delta', index, text: content }
      yield { type: 'block-end', index, block: { type: 'text', text: content } }
    }

    const channelToolCalls = (choice.message?.tool_calls ?? []).map((toolCall) => ({
      id: String(toolCall.id),
      name: String(toolCall.function?.name ?? ''),
      arguments: String(toolCall.function?.arguments ?? '{}'),
    }))
    for (const toolCall of channelToolCalls) {
      const index = nextBlockIndex++
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

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: mapFinishReason(choice.finish_reason) }
  }
}

function mapFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case undefined:
    case 'stop':
      return { kind: 'stop' }
    case 'tool_calls':
    case 'function_call':
      return { kind: 'tool-calls' }
    case 'length':
      return { kind: 'max-tokens' }
    default:
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
      }
  }
}
