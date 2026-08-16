/**
 * Session-level DCP statistics recomputed from the log.
 *
 * @module dsh-dcp/stats/session
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { decodeDcpMeta } from '../protocol/metadata.js'

export interface SessionStats {
  blockCount: number
  shadowedTokens: number
  checkpointTokens: number
  pruneReplacements: number
  markerTokens: number
  netSavedTokens: number
}

function heuristicTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4))
}

export function computeSessionStats(events: readonly SessionEvent[]): SessionStats {
  let blockCount = 0
  let shadowedTokens = 0
  let checkpointTokens = 0
  let pruneReplacements = 0
  let markerTokens = 0

  for (let index = 0; index < events.length; index++) {
    const event = events[index]!
    switch (event.type) {
      case 'compaction/summary': {
        const next = events[index + 1]
        const isDcp =
          next?.type === 'user/message' &&
          next.surfaceOp !== 'append' &&
          decodeDcpMeta(next.data.source).ok
        if (isDcp) shadowedTokens += event.data.shadowedTokenCount
        break
      }
      case 'compaction/prune': {
        const next = events[index + 1]
        const nextText =
          next?.type === 'tool/result' || next?.type === 'assistant/message'
            ? next.data.message.content
                .flatMap((block) => (block.type === 'tool-result' ? block.content : [block]))
                .filter((block) => block.type === 'text')
                .map((block) => (block.type === 'text' ? block.text : ''))
                .join('\n')
            : next?.type === 'user/message'
              ? next.data.content
                  .filter((block) => block.type === 'text')
                  .map((block) => (block.type === 'text' ? block.text : ''))
                  .join('\n')
              : ''
        const isDcp =
          nextText.includes('[duplicate ') || nextText.includes('[errored tool unit removed]')
        if (isDcp) pruneReplacements++
        break
      }
      case 'user/message': {
        const text = event.data.content
          .filter((block) => block.type === 'text')
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('\n')
        if (text.includes('<dcp-boundary ref=')) markerTokens += heuristicTokens(text)
        if (decodeDcpMeta(event.data.source).ok) {
          blockCount++
          checkpointTokens += heuristicTokens(text)
        }
        break
      }
    }
  }

  return {
    blockCount,
    shadowedTokens,
    checkpointTokens,
    pruneReplacements,
    markerTokens,
    netSavedTokens: Math.max(0, shadowedTokens - checkpointTokens),
  }
}
