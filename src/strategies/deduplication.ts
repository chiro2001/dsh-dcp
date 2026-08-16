/**
 * Deterministic tool-result deduplication (v0.1).
 *
 * @module dsh-dcp/strategies/deduplication
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { freezeMessage } from '@deepseek-ai/dsh-llm/message'
import type { DcpConfig } from '../config.js'
import { matchesGlob } from '../protection/patterns.js'
import { maxTurn, turnOfSeq } from '../protocol/turns.js'

export interface DedupTarget {
  seq: number
  callId: string
  tool: string
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined && entry !== null)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    )
  }
  return value
}

function canonicalJson(args: string): string {
  try {
    return JSON.stringify(sortValue(JSON.parse(args) as unknown))
  } catch {
    return args
  }
}

function filePathsOf(tool: string, args: string): string[] {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>
    if (typeof parsed.filePath === 'string') return [parsed.filePath]
    return []
  } catch {
    return []
  }
}

export function dedupCandidates(session: Session, config: DcpConfig): DedupTarget[] {
  const events = session.events
  const calls = new Map<string, { tool: string; args: string }>()
  for (const event of events) {
    if (event.type === 'tool/call') {
      calls.set(String(event.data.callId), {
        tool: event.data.name,
        args: event.data.arguments,
      })
    }
  }

  const latestTurn = maxTurn(events)
  const results: Array<{ seq: number; callId: string; tool: string }> = []
  for (const seq of session.surface.nodes) {
    const event = events[seq]
    if (event?.type !== 'tool/result') continue
    if (event.surfaceOp !== 'append') continue
    const callId = String(event.data.message.source.callId)
    const call = calls.get(callId)
    if (!call) continue
    const turn = turnOfSeq(events, seq) ?? 0
    if (turn > latestTurn - config.compress.retainRecentTurns) continue
    if (config.strategies.deduplication.protectedTools.includes(call.tool)) continue
    if (
      config.protectedFilePatterns.some((pattern) =>
        filePathsOf(call.tool, call.args).some((path) => matchesGlob(path, pattern)),
      )
    ) {
      continue
    }
    results.push({
      seq,
      callId,
      tool: call.tool,
    })
  }

  const groups = new Map<string, DedupTarget[]>()
  for (const result of results) {
    const call = calls.get(result.callId)!
    const signature = `${call.tool}::${canonicalJson(call.args)}`
    const group = groups.get(signature) ?? []
    group.push(result)
    groups.set(signature, group)
  }

  const targets: DedupTarget[] = []
  for (const group of groups.values()) {
    if (group.length <= 1) continue
    const ordered = group.toSorted((left, right) => left.seq - right.seq)
    targets.push(...ordered.slice(0, -1))
  }
  return targets
}

export function applyDeduplication(
  session: Session,
  tokenMeter: TokenMeter,
  config: DcpConfig,
): { replaced: number; tokensSaved: number } {
  let replaced = 0
  let tokensSaved = 0
  for (const target of dedupCandidates(session, config)) {
    const event = session.events[target.seq]
    if (event?.type !== 'tool/result') continue
    const tokens = tokenMeter.estimateMessage(event.data.message)
    const pruned = freezeMessage({
      ...event.data.message,
      content: [
        {
          ...event.data.message.content[0],
          content: [
            {
              type: 'text',
              text: `[duplicate ${target.tool} output removed; a newer identical call supersedes it]`,
            },
          ],
        },
      ],
    } as never)
    session.append('compaction/prune', {
      shadowedRange: { start: target.seq, end: target.seq },
      shadowedSeqs: [target.seq],
      shadowedTokenCount: tokens,
    })
    session.append(
      'tool/result',
      {
        turn: event.data.turn,
        step: event.data.step,
        message: pruned,
      },
      {
        surfaceOp: { op: 'replace', start: target.seq, end: target.seq },
        sourceEventSeqs: [target.seq],
      },
    )
    replaced++
    tokensSaved += tokens
  }
  return { replaced, tokensSaved }
}
