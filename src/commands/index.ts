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
import { scheduleCompress } from './compress.js'
import { renderBlockShow } from './recovery.js'
import { reduceDcpState } from '../protocol/replay.js'
import { controlMessage } from '../strategies/control.js'

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
        case 'compress': {
          const focus = tokens.slice(1).join(' ')
          return { kind: 'success', text: scheduleCompress(invocation.agent, focus).text }
        }
        case 'show': {
          const ref = tokens[1]?.toLowerCase()
          if (!ref || !/^b\d+$/.test(ref)) {
            return { kind: 'error', text: 'Usage: /dcp show <bN> [--raw]' }
          }
          const state = reduceDcpState(invocation.agent.session.events)
          return {
            kind: 'success',
            text: renderBlockShow(
              invocation.agent.session,
              state,
              ref,
              tokens.includes('--raw'),
            ),
          }
        }
        case 'decompress': {
          const ref = tokens[1]?.toLowerCase()
          if (!ref || !/^b\d+$/.test(ref)) {
            return { kind: 'error', text: 'Usage: /dcp decompress <bN> [--into-context]' }
          }
          if (tokens.includes('--into-context')) {
            invocation.agent.followup(controlMessage(`expand ${ref}`))
            return {
              kind: 'success',
              text: `${ref} will be expanded into quoted context in a control turn.`,
            }
          }
          const state = reduceDcpState(invocation.agent.session.events)
          return {
            kind: 'success',
            text: `${renderBlockShow(invocation.agent.session, state, ref, true)}\n\nNote: model context is unchanged (raw show only). Use --into-context to expand.`,
          }
        }
        case 'recompress': {
          const ref = tokens[1]?.toLowerCase()
          if (!ref || !/^b\d+$/.test(ref)) {
            return { kind: 'error', text: 'Usage: /dcp recompress <bN>' }
          }
          invocation.agent.followup(controlMessage(`recompress ${ref}`))
          return { kind: 'success', text: `${ref} will be re-compressed in a control turn.` }
        }
        default:
          return {
            kind: 'error',
            text: `Unknown /dcp subcommand "${subcommand}". Use /dcp help.`,
          }
      }
    },
  })

  ctx.commands.register({
    name: 'dcp-compress',
    description: 'Trigger DCP manual compression',
    input: { hint: '[focus]' },
    async handler(invocation: CommandInvocation) {
      const focus = invocation.rawInput.trim()
      return { kind: 'success', text: scheduleCompress(invocation.agent, focus).text }
    },
  })
}
