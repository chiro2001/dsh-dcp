/**
 * Same-step inline summary cleanup (E-01 verified host contract).
 *
 * @module dsh-dcp/compress/inline-cleanup
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { freezeMessage } from '@deepseek-ai/dsh-llm/message'

export interface CleanupResult {
  cleaned: boolean
  warning?: string
}

/**
 * Rewrite the model's inline summary arguments inside the author assistant
 * message to `[stored in <blockRef>]`, preserving every other block and the
 * message identity. Requires an open turn/step (tool execution context).
 */
export function cleanupInlineSummary(
  session: Session,
  tokenMeter: TokenMeter,
  compressCallId: string,
  blockRef: string,
): CleanupResult {
  let authorSeq: number | undefined
  let original: (typeof session.events)[number] | undefined
  for (const seq of session.surface.nodes) {
    const event = session.events[seq]
    if (event?.type !== 'assistant/message') continue
    const hasCall = event.data.message.content.some(
      (block) => block.type === 'tool-call' && block.id === compressCallId,
    )
    if (hasCall) {
      authorSeq = seq
      original = event
      break
    }
  }

  if (authorSeq === undefined || original?.type !== 'assistant/message') {
    return { cleaned: false, warning: 'author assistant message not found for inline cleanup' }
  }

  const message = original.data.message
  let rewritten = false
  const content = message.content.map((block) => {
    if (block.type !== 'tool-call' || block.id !== compressCallId) return block
    try {
      const parsed = JSON.parse(block.arguments) as {
        content?: Array<{ summary?: string }>
      }
      if (Array.isArray(parsed.content)) {
        for (const entry of parsed.content) {
          if (entry && typeof entry.summary === 'string') {
            entry.summary = `[stored in ${blockRef}]`
            rewritten = true
          }
        }
      }
      return { ...block, arguments: JSON.stringify(parsed) }
    } catch {
      return block
    }
  })
  if (!rewritten) {
    return { cleaned: false, warning: 'no inline summary argument found to clean' }
  }

  const cleanedMessage = freezeMessage({ ...message, content } as never)
  session.append('compaction/prune', {
    shadowedRange: { start: authorSeq, end: authorSeq },
    shadowedSeqs: [authorSeq],
    shadowedTokenCount: tokenMeter.estimateMessage(message),
  })
  session.append(
    'assistant/message',
    {
      turn: original.data.turn,
      step: original.data.step,
      message: cleanedMessage,
    },
    {
      surfaceOp: { op: 'replace', start: authorSeq, end: authorSeq },
      sourceEventSeqs: [authorSeq],
    },
  )
  return { cleaned: true }
}
