/**
 * Internal control-turn messages (never reach the model).
 *
 * @module dsh-dcp/strategies/control
 */

import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'

export const DCP_CONTROL_PREFIX = '<dcp-control>'

export function controlMessage(kind: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: `${DCP_CONTROL_PREFIX}${kind}` }],
    source: { kind: 'plugin', plugin: 'dsh-dcp' },
  }) as UserMessage
}

export function isDcpControlMessage(message: {
  content: readonly { type: string; text?: string }[]
}): boolean {
  return message.content.some(
    (block) => block.type === 'text' && block.text?.startsWith(DCP_CONTROL_PREFIX),
  )
}

export type ControlKind = 'sweep' | 'expand' | 'recompress'

export interface ParsedControl {
  kind: ControlKind
  arg?: string
}

export function parseControl(message: {
  content: readonly { type: string; text?: string }[]
}): ParsedControl | undefined {
  const text = message.content.find(
    (block) => block.type === 'text' && block.text?.startsWith(DCP_CONTROL_PREFIX),
  )?.text
  if (!text) return undefined
  const body = text.slice(DCP_CONTROL_PREFIX.length).trim()
  if (body === 'sweep') return { kind: 'sweep' }
  const expand = /^expand (b\d+)$/.exec(body)
  if (expand) return { kind: 'expand', arg: expand[1] }
  const recompress = /^recompress (b\d+)$/.exec(body)
  if (recompress) return { kind: 'recompress', arg: recompress[1] }
  return undefined
}
