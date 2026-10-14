import './protocol/source.js'
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
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { buildStepMarkerMessage } from './refs/marker.js'
import { computeNudge } from './prompts/nudge.js'
import { collectNativeAliases } from './refs/alias.js'
import { cleanupPendingCompressSteps } from './compress/step-cleanup.js'
import {
  openDcpStatsStore,
  registerDcpStatsStore,
  unregisterDcpStatsStore,
} from './stats/domain-store.js'

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

  if (resolved.compress.enabled) {
    ctx.systemPrompt.section({
      name: DCP_GUIDANCE_SECTION,
      order: DCP_GUIDANCE_ORDER,
      text: () => renderDcpGuidance(resolved, resolved.manualMode.default),
    })
    ctx.tools.register(createCompressTool(ctx, resolved))
  }

  registerDcpCommands(ctx, resolved)

  ctx.on('agent/turn-stopping', ({ agent }) => {
    for (const warning of cleanupPendingCompressSteps(agent.session, ctx.tokenMeter)) {
      logger.warn('observed compress cleanup failed: %s', warning)
    }
  })

  ctx.on(
    'agent/pre-step',
    async ({ agent, turn, step, signal }, next): Promise<PreStepDecision> => {
      let decision = await next()
      if (
        signal.aborted ||
        decision.kind !== 'enter' ||
        (step === 1 && decision.messages.length === 0)
      )
        return decision
      for (const warning of cleanupPendingCompressSteps(agent.session, ctx.tokenMeter)) {
        logger.warn('deferred compress cleanup failed: %s', warning)
      }
      const state = reduceDcpState(agent.session.snapshotEvents(), resolved.manualMode.default)
      if (decision.messages.some(isDcpControlMessage)) {
        for (const message of decision.messages) {
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
        const admitted = decision.messages.filter((message) => !isDcpControlMessage(message))
        if (admitted.length === 0) return { ...decision, messages: [] }
        decision = { ...decision, messages: admitted }
      }
      if (decision.kind === 'enter') {
        applyAutomaticStrategies(agent.session, ctx.tokenMeter, resolved, state.manualMode)
        const currentState = reduceDcpState(
          agent.session.snapshotEvents(),
          resolved.manualMode.default,
        )
        if (!resolved.compress.enabled) return decision
        const nudgeText = currentState.manualMode
          ? undefined
          : computeNudge(agent.session, ctx.tokenMeter.measure(agent.session), resolved).text
        const aliasLines = collectNativeAliases(
          agent.session,
          currentState,
          resolved.references.maxAliasEntries,
        )
        const extraText = aliasLines.length > 0 ? aliasLines.join('\n') : undefined
        if (step === 1 || resolved.references.granularity === 'step') {
          const ref = `m${String(currentState.maxMarkerNumber + 1).padStart(4, '0')}`
          const marker = buildStepMarkerMessage(ref, turn, step, nudgeText, extraText)
          return { ...decision, messages: [marker, ...decision.messages] }
        }
        const text = [nudgeText, extraText].filter(Boolean).join('\n')
        if (text.length === 0) return decision
        const context = createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'dsh-dcp' },
        })
        return { ...decision, messages: [context, ...decision.messages] }
      }
      return decision
    },
  )

  ctx.inject(['storageDomain'], async (child): Promise<() => Promise<void>> => {
    try {
      const handle = await openDcpStatsStore(child)
      if (!handle) return async () => {}
      // Register on the outer plugin context so command closures (which
      // capture `ctx`) resolve the same store identity.
      registerDcpStatsStore(ctx, handle.store)
      return async () => {
        unregisterDcpStatsStore(ctx)
        await handle.close()
      }
    } catch (error) {
      logger.warn(
        'dcp stats domain unavailable: %s',
        error instanceof Error ? error.message : String(error),
      )
      return async () => {}
    }
  })

  if (resolved.debug) {
    logger.info('dsh-dcp initialized', { transport: resolved.references.transport })
  }
}
