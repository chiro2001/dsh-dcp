/**
 * /dcp manual — state persists via command lifecycle replay.
 *
 * @module dsh-dcp/commands/manual
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DcpConfig } from '../config.js'
import { reduceDcpState } from '../protocol/replay.js'

export function currentManualMode(agent: Agent, config: DcpConfig): boolean {
  return reduceDcpState(agent.session.events, config.manualMode.default).manualMode
}

export function manualResult(
  current: boolean,
  rawArg: string | undefined,
): { text: string; next: boolean } {
  const arg = rawArg?.toLowerCase()
  if (arg === 'on') return { text: 'Manual mode is now ON.', next: true }
  if (arg === 'off') return { text: 'Manual mode is now OFF.', next: false }
  if (arg === 'status') {
    return { text: `Manual mode is ${current ? 'ON' : 'OFF'}.`, next: current }
  }
  return {
    text: `Usage: /dcp manual [on|off|status]. Current: ${current ? 'ON' : 'OFF'}.`,
    next: current,
  }
}
