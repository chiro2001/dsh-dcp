/**
 * Pressure nudge with hysteresis, fully derived from the log.
 *
 * @module dsh-dcp/prompts/nudge
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import type { DcpConfig } from '../config.js'
import { decodeDcpMeta } from '../protocol/metadata.js'

export interface NudgeResult {
  text?: string
  armed: boolean
  stepsSinceNudge: number
}

export function computeNudge(
  session: Session,
  measure: TokenMeasurement,
  config: DcpConfig,
): NudgeResult {
  let markerCount = 0
  let lastNudgeMarker = 0
  let compressionAfterNudge = false

  for (const event of session.events) {
    if (event.type !== 'user/message') continue
    const text = event.data.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    if (text.includes('<dcp-boundary')) markerCount++
    if (text.includes('DCP compression recommended')) lastNudgeMarker = markerCount
    if (decodeDcpMeta(event.data.source).ok) compressionAfterNudge = true
  }

  const stepsSinceNudge = markerCount - lastNudgeMarker
  const armed = lastNudgeMarker === 0 ? markerCount > 0 : compressionAfterNudge
  const contextWindow = session.requestContext()?.contextWindow
  if (!config.nudge.enabled || contextWindow === undefined) {
    return { armed, stepsSinceNudge }
  }
  const ratio = measure.totalTokens / contextWindow
  if (
    ratio > config.nudge.maxRatio &&
    armed &&
    stepsSinceNudge >= config.nudge.frequencySteps
  ) {
    return {
      text: `DCP compression recommended: context is at ${Math.round(ratio * 100)}% of the model window. Compress a closed range to free space.`,
      armed,
      stepsSinceNudge,
    }
  }
  return { armed, stepsSinceNudge }
}
