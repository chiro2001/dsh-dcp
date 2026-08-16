/**
 * dcp command registration.
 *
 * @module dsh-dcp/commands/index
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { DcpConfig } from '../config.js'
import { renderHelp } from './help.js'
import { renderContext } from './context.js'
import { renderStats } from './stats.js'
import { currentManualMode, manualResult } from './manual.js'
import { scheduleSweep } from './sweep.js'

export function registerDcpCommands(ctx: Context, config: DcpConfig): void {
  ctx.commands.register({
    name: 'dcp',
    description: 'DCP context management',
    input: { hint: 'help|context' },
    async handler(invocation: CommandInvocation) {
      const tokens = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
      const subcommand = (tokens[0] ?? 'help').toLowerCase()
      switch (subcommand) {
        case 'help':
          return { kind: 'success', text: renderHelp() }
        case 'context':
          return { kind: 'success', text: renderContext(ctx, invocation.agent) }
        case 'stats':
          return { kind: 'success', text: renderStats(ctx, invocation.agent) }
        case 'manual': {
          const current = currentManualMode(invocation.agent, config)
          const result = manualResult(current, tokens[1])
          return { kind: 'success', text: result.text }
        }
        case 'sweep':
          return { kind: 'success', text: scheduleSweep(invocation.agent).text }
        default:
          return {
            kind: 'error',
            text: `Unknown /dcp subcommand "${subcommand}". Use /dcp help.`,
          }
      }
    },
  })
}
