/**
 * Turn lookup over the session log (surface nodes do not carry turn data on
 * user messages, so we track enclosure from turn/start..turn/end).
 *
 * @module dsh-dcp/protocol/turns
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

export function turnOfSeq(events: readonly SessionEvent[], seq: number): number | undefined {
  let currentTurn: number | undefined
  for (let index = 0; index <= seq && index < events.length; index++) {
    const event = events[index]!
    if (event.type === 'turn/start') currentTurn = event.data.turn
    if (event.type === 'turn/end') currentTurn = undefined
    if (index === seq) {
      if (event.type === 'assistant/message' || event.type === 'tool/result') {
        return event.data.turn
      }
      return currentTurn
    }
  }
  return undefined
}

export function maxTurn(events: readonly SessionEvent[]): number {
  let current: number | undefined
  let maximum = 0
  for (const event of events) {
    if (event.type === 'turn/start') current = event.data.turn
    if (event.type === 'turn/end') current = undefined
    if (current !== undefined) maximum = Math.max(maximum, current)
  }
  return maximum
}

export function openTurnOf(events: readonly SessionEvent[]): number | null {
  let current: number | null = null
  for (const event of events) {
    if (event.type === 'turn/start') current = event.data.turn
    if (event.type === 'turn/end') current = null
  }
  return current
}
