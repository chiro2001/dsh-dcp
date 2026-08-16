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

export function registerDcpCommands(ctx: Context, _config: DcpConfig): void {
  ctx.commands.register({
    name: 'dcp',
    description: 'DCP context management',
    input: { hint: 'help|context' },
    async handler(invocation: CommandInvocation) {
      const subcommand = (
        invocation.rawInput.trim().split(/\s+/).find(Boolean) ?? 'help'
      ).toLowerCase()
      switch (subcommand) {
        case 'help':
          return { kind: 'success', text: renderHelp() }
        case 'context':
          return { kind: 'success', text: renderContext(ctx, invocation.agent) }
        default:
          return {
            kind: 'error',
            text: `Unknown /dcp subcommand "${subcommand}". Use /dcp help.`,
          }
      }
    },
  })
}
