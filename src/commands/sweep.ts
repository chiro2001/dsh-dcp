/**
 * /dcp sweep — schedule an internal control turn that runs strategies
 * without a model request.
 *
 * @module dsh-dcp/commands/sweep
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { controlMessage } from '../strategies/control.js'

export function scheduleSweep(agent: Agent): { text: string } {
  agent.followup(controlMessage('sweep'))
  return { text: 'Sweep scheduled in a control turn (no model request).' }
}
