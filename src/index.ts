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
import { buildStepMarkerMessage } from './refs/marker.js'
import { computeNudge } from './prompts/nudge.js'
import { collectNativeAliases } from './refs/alias.js'

export const name = 'dsh-dcp'

export const inject = ['sessions', 'tokenMeter', 'systemPrompt', 'tools', 'commands']

export { Config }

export function apply(ctx: Context, config: DcpConfig): void {
  const resolved = resolveConfig(config)
  const logger = ctx.logger('dsh-dcp')
  if (!resolved.enabled) {
    logger.info('dsh-dcp disabled by config')
    return
  }
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
    async ({ agent, messages, turn, step, signal }, next): Promise<PreStepDecision> => {
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
            const result = applyExpansion(agent.session, ctx.tokenMeter, control.arg)
            if (!result.ok)
              ctx.logger('dsh-dcp').warn('control expand failed: %s', result.error)
          }
          if (control.kind === 'recompress' && control.arg) {
            const result = applyRecompress(agent.session, ctx.tokenMeter, control.arg)
            if (!result.ok)
              ctx.logger('dsh-dcp').warn('control recompress failed: %s', result.error)
          }
        }
        return { kind: 'enter', messages: [] }
      }
      if (decision.kind === 'enter') {
        applyAutomaticStrategies(agent.session, ctx.tokenMeter, resolved, state.manualMode)
        const currentState = reduceDcpState(agent.session.events, resolved.manualMode.default)
        const ref = `m${String(currentState.maxMarkerNumber + 1).padStart(4, '0')}`
        const nudge = computeNudge(
          agent.session,
          ctx.tokenMeter.measure(agent.session),
          resolved,
        )
        const aliasLines = collectNativeAliases(
          agent.session,
          currentState,
          resolved.references.maxAliasEntries,
        )
        const marker = buildStepMarkerMessage(
          ref,
          turn,
          step,
          nudge.text,
          aliasLines.length > 0 ? aliasLines.join('\n') : undefined,
        )
        return { kind: 'enter', messages: [marker, ...decision.messages] }
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
