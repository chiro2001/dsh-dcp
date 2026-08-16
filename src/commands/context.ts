/**
 * /dcp context — read-only token breakdown.
 *
 * @module dsh-dcp/commands/context
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { reduceDcpState } from '../protocol/replay.js'

export function renderContext(ctx: Context, agent: Agent): string {
  const session = agent.session
  const measure = ctx.tokenMeter.measure(session)
  const projectionService = ctx.get('sessionProjections') as
    { snapshot(session: unknown): { values: Record<string, unknown> } } | undefined
  const values = projectionService?.snapshot(session).values ?? {}
  const breakdown = values.contextBreakdown as
    { messageTokens?: number; systemTokens?: number; toolsTokens?: number } | undefined
  const pressure = values.contextPressure as
    { pressureTokens?: number; projectedTokens?: number } | undefined
  const state = reduceDcpState(session.events)

  const lines = [
    'DCP context:',
    `  surface tokens:  ~${measure.surfaceTokens}`,
    `  message tokens:  ~${breakdown?.messageTokens ?? 'n/a'}`,
    `  system tokens:   ~${breakdown?.systemTokens ?? 'n/a'}`,
    `  tools tokens:    ~${breakdown?.toolsTokens ?? 'n/a'}`,
    `  pressure:        ~${pressure?.pressureTokens ?? 'n/a'}`,
    `  projected:       ~${pressure?.projectedTokens ?? 'n/a'}`,
    `  active blocks:   ${state.activeBlockRefs.length ? state.activeBlockRefs.join(', ') : '(none)'}`,
    `  boundaries:      ${state.boundaryRefs.filter((entry) => entry.active).length}`,
  ]
  return lines.join('\n')
}
