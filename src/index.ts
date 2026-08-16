/**
 * dsh-dcp plugin entry (M1): system guidance, compress tool, /dcp commands,
 * settings namespace.
 *
 * @module dsh-dcp
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { Config, resolveConfig, unknownConfigKeys, type DcpConfig } from './config.js'
import {
  DCP_GUIDANCE_ORDER,
  DCP_GUIDANCE_SECTION,
  renderDcpGuidance,
} from './prompts/system.js'
import { createCompressTool } from './compress/tool.js'
import { registerDcpCommands } from './commands/index.js'
import { reduceDcpState } from './protocol/replay.js'
import { applyAutomaticStrategies } from './strategies/index.js'
import { isDcpControlMessage, parseControl } from './strategies/control.js'
import { applyExpansion, applyRecompress } from './commands/recovery.js'

export const name = 'dsh-dcp'

export const inject = ['sessions', 'tokenMeter', 'systemPrompt', 'tools', 'commands']

export { Config }

export function apply(ctx: Context, config: DcpConfig): void {
  const resolved = resolveConfig(config)
  const logger = ctx.logger('dsh-dcp')
  const unknown = unknownConfigKeys(config as unknown as Record<string, unknown>)
  if (unknown.length > 0) {
    logger.warn('dcp config contains unknown keys: %s', unknown.join(', '))
  }

  ctx.systemPrompt.section({
    name: DCP_GUIDANCE_SECTION,
    order: DCP_GUIDANCE_ORDER,
    text: () => renderDcpGuidance(resolved, resolved.manualMode.default),
  })

  if (resolved.compress.enabled) {
    ctx.tools.register(createCompressTool(ctx, resolved))
  }

  registerDcpCommands(ctx, resolved)

  ctx.on(
    'agent/pre-step',
    async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (signal.aborted) return decision
      const state = reduceDcpState(agent.session.events, resolved.manualMode.default)
      if (messages.some(isDcpControlMessage)) {
        for (const message of messages) {
          const control = parseControl(message)
          if (!control) continue
          if (control.kind === 'sweep') {
            applyAutomaticStrategies(agent.session, ctx.tokenMeter, resolved, state.manualMode)
          }
          if (control.kind === 'expand' && control.arg) {
            applyExpansion(agent.session, ctx.tokenMeter, control.arg)
          }
          if (control.kind === 'recompress' && control.arg) {
            applyRecompress(agent.session, ctx.tokenMeter, control.arg)
          }
        }
        return { kind: 'enter', messages: [] }
      }
      if (decision.kind === 'enter') {
        applyAutomaticStrategies(agent.session, ctx.tokenMeter, resolved, state.manualMode)
      }
      return decision
    },
  )

  const settings = ctx.get('settings') as
    { register?: (ns: string, schema: unknown) => void } | undefined
  settings?.register?.('dcp', Config)

  if (resolved.debug) {
    logger.info('dsh-dcp initialized', { transport: resolved.references.transport })
  }
}
