/**
 * /dcp compress — schedule a model turn that instructs the model to run
 * `compress` (manual trigger, fully logged).
 *
 * @module dsh-dcp/commands/compress
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'

const TRIGGER = [
  '<compress triggered manually>',
  'Manual mode trigger received. You must now use the compress tool.',
  'Find the most significant completed conversation content that can be compressed into a high-fidelity technical summary.',
  'Choose safe, closed, tool-pairing-balanced ranges and return after compress with a brief explanation.',
].join('\n\n')

export function scheduleCompress(agent: Agent, focus?: string): { text: string } {
  const prompt = focus?.trim()
    ? `${TRIGGER}\n\nAdditional user focus:\n${focus.trim()}`
    : TRIGGER
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'dsh-dcp' },
    }),
  )
  return {
    text: 'Compression triggered; the model will select closed ranges in the next turn.',
  }
}
