/**
 * Experimental purge-errors prototype: replace an entire balanced errored
 * tool unit with a deterministic checkpoint. Disabled by default.
 *
 * @module dsh-dcp/strategies/purge-errors
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import {
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
} from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { DcpConfig } from '../config.js'
import { maxTurn, turnOfSeq } from '../protocol/turns.js'

export interface PurgeTarget {
  assistantSeq: number
  resultSeq: number
  tool: string
  errorText: string
  tokensIn: number
}

export function purgeTargets(
  session: Session,
  tokenMeter: TokenMeter,
  config: DcpConfig,
): PurgeTarget[] {
  const events = session.events
  const calls = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'tool/call') calls.set(String(event.data.callId), event.data.name)
  }
  const latestTurn = maxTurn(events)
  const targets: PurgeTarget[] = []

  for (const seq of session.surface.nodes) {
    const event = events[seq]
    if (event?.type !== 'tool/result' || !event.data.message.content[0]?.isError) continue
    if (event.surfaceOp !== 'append') continue
    const callId = String(event.data.message.source.callId)
    const turn = turnOfSeq(events, seq) ?? 0
    if (turn > latestTurn - config.strategies.purgeErrors.turns) continue
    const tool = calls.get(callId) ?? 'unknown'
    if (config.strategies.purgeErrors.protectedTools.includes(tool)) continue

    // Locate the owning assistant message.
    const assistantSeq = [...session.surface.nodes].find((candidate) => {
      const candidateEvent = events[candidate]
      return (
        candidateEvent?.type === 'assistant/message' &&
        candidateEvent.data.message.content.some(
          (block) => block.type === 'tool-call' && block.id === callId,
        )
      )
    })
    if (assistantSeq === undefined) continue
    const assistantEvent = events[assistantSeq]
    if (assistantEvent?.type !== 'assistant/message') continue
    const toolCalls = assistantEvent.data.message.content.filter(
      (block) => block.type === 'tool-call',
    )
    // Prototype: only single-call units are safe to replace whole.
    if (toolCalls.length !== 1) continue
    if (
      !toolPairingBalancedBefore(session, assistantSeq) ||
      !toolPairingBalancedAfter(session, seq)
    ) {
      continue
    }
    const errorText =
      event.data.message.content
        .flatMap((block) => (block.type === 'tool-result' ? block.content : []))
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n') || 'tool failed (no error text)'
    const tokensIn =
      tokenMeter.estimateMessage(assistantEvent.data.message) +
      tokenMeter.estimateMessage(event.data.message)
    targets.push({ assistantSeq, resultSeq: seq, tool, errorText, tokensIn })
  }
  return targets
}

export function applyPurgeErrors(
  session: Session,
  tokenMeter: TokenMeter,
  config: DcpConfig,
): { purged: number; tokensSaved: number } {
  let purged = 0
  let tokensSaved = 0
  for (const target of purgeTargets(session, tokenMeter, config)) {
    const checkpointText = `[errored tool unit removed]\ntool: ${target.tool}\nerror: ${target.errorText}`
    const checkpoint = createUserMessage({
      content: [{ type: 'text', text: checkpointText }],
      source: { kind: 'plugin', plugin: 'dsh-dcp' },
    })
    const tokensOut = tokenMeter.estimateMessage(checkpoint)
    if (tokensOut >= target.tokensIn) continue
    session.append('compaction/prune', {
      shadowedRange: { start: target.assistantSeq, end: target.resultSeq },
      shadowedSeqs: [target.assistantSeq, target.resultSeq],
      shadowedTokenCount: target.tokensIn,
    })
    session.append('user/message', checkpoint, {
      surfaceOp: { op: 'replace', start: target.assistantSeq, end: target.resultSeq },
      sourceEventSeqs: [target.assistantSeq, target.resultSeq],
    })
    purged++
    tokensSaved += target.tokensIn - tokensOut
  }
  return { purged, tokensSaved }
}
