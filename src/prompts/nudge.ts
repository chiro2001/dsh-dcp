/**
 * Pressure nudge with hysteresis, fully derived from the log.
 *
 * @module dsh-dcp/prompts/nudge
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionSeq } from '@deepseek-ai/dsh-session'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import type { DcpConfig } from '../config.js'
import { isDcpSource } from '../protocol/source.js'
import { decodeDcpMeta } from '../protocol/metadata.js'

export interface NudgeResult {
  text?: string
  armed: boolean
  stepsSinceNudge: number
}

function hasCommittedRange(resultText: string): boolean {
  const committed = /\bcommitted=([^;.]*)/.exec(resultText)?.[1]?.trim()
  return committed !== undefined && committed.length > 0 && committed !== 'none'
}

function isRejectedCompressOutcome(isError: boolean, resultText: string): boolean {
  const status = /\bstatus=(success|partial|rejected)\b/.exec(resultText)?.[1]
  if ((status === 'success' || status === 'partial') && hasCommittedRange(resultText)) {
    return false
  }
  if (status === 'rejected') return true
  return isError
}

export function computeNudge(
  session: Session,
  measure: TokenMeasurement,
  config: DcpConfig,
): NudgeResult {
  let stepCount = 0
  let lastNudgeStep = 0
  let lastNudgeSeq: SessionSeq | -1 = -1
  let lastCompressionSeq: SessionSeq | -1 = -1
  let lastCompressCallId: string | undefined
  let lastCompressOutcomeSeq: SessionSeq | -1 = -1
  let lastCompressOutcomeRejected = false

  for (const event of session.snapshotEvents()) {
    if (event.type === 'step/start') {
      stepCount++
      continue
    }
    if (event.type === 'tool/call' && event.data.name === 'compress') {
      lastCompressCallId = String(event.data.callId)
      continue
    }
    if (
      event.type === 'tool/result' &&
      lastCompressCallId !== undefined &&
      String(event.data.message.source.callId) === lastCompressCallId
    ) {
      lastCompressOutcomeSeq = event.seq
      const resultText = event.data.message.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
      lastCompressOutcomeRejected = isRejectedCompressOutcome(
        event.data.message.isError === true,
        resultText,
      )
      continue
    }
    if (event.type !== 'user/message') continue
    const text = event.data.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    if (isDcpSource(event.data.source) && text.includes('DCP compression recommended')) {
      lastNudgeStep = stepCount
      lastNudgeSeq = event.seq
    }
    if (decodeDcpMeta(event.data.source).ok) lastCompressionSeq = event.seq
  }

  let stepsSinceNudge = stepCount - lastNudgeStep
  const armedByCompression =
    lastNudgeStep === 0 ? stepCount > 0 : lastCompressionSeq > lastNudgeSeq
  const rejectedAfterNudge =
    lastNudgeSeq !== -1 && lastCompressOutcomeRejected && lastCompressOutcomeSeq > lastNudgeSeq
  const armed = armedByCompression && !rejectedAfterNudge
  const contextWindow = session.requestContext()?.contextWindow
  if (!config.nudge.enabled) {
    return { armed, stepsSinceNudge }
  }
  const ratio = contextWindow === undefined ? undefined : measure.totalTokens / contextWindow
  if (ratio !== undefined && ratio <= config.nudge.minRatio) {
    // Below the lower bound: re-arm the frequency counter (hysteresis).
    stepsSinceNudge = 0
  }
  if (
    ratio !== undefined &&
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
  if (ratio === undefined && armed && stepsSinceNudge >= config.nudge.iterationThreshold) {
    return {
      text: 'DCP compression recommended: long-running step chain without pressure data. Compress a closed range to keep context bounded.',
      armed,
      stepsSinceNudge,
    }
  }
  return { armed, stepsSinceNudge }
}
