import {
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { CallId } from '@deepseek-ai/dsh-llm/brand'

export interface ScriptedStep {
  text?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  hang?: boolean
}

/** Deterministic adapter for AgentLoop integration tests (no network). */
export class ScriptedAdapter extends LlmAdapter {
  dispatchCount = 0

  script: ScriptedStep[]

  constructor(script: ScriptedStep[]) {
    super()
    this.script = script
  }

  providerInfo(provider: string) {
    return { id: provider, name: 'scripted' }
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const step = this.script[Math.min(this.dispatchCount, this.script.length - 1)]!
    this.dispatchCount++
    if (step.hang) {
      const aborted = new Promise<never>((_resolve, reject) => {
        if (_options.signal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'))
          return
        }
        _options.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        )
      })
      await aborted.catch(() => {})
      yield {
        type: 'finish',
        reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } },
      }
      return
    }
    if (step.text) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: step.text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: step.text } }
    }
    for (const [index, toolCall] of (step.toolCalls ?? []).entries()) {
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index,
        id: CallId(toolCall.id),
        name: toolCall.name,
        argumentsDelta: toolCall.arguments,
      }
      yield {
        type: 'block-end',
        index,
        block: {
          type: 'tool-call',
          id: CallId(toolCall.id),
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      }
    }
    const usage: TokenUsage = { inputTokens: 10, outputTokens: 5 }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
