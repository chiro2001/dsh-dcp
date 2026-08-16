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
