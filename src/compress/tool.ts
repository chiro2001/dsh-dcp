/**
 * Model-facing `compress` tool registration (exclusive, host approval).
 *
 * @module dsh-dcp/compress/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { Session } from '@deepseek-ai/dsh-session'
import type { DcpConfig } from '../config.js'
import { executeCompressRange, type CompressRangeResult } from './pipeline.js'

export function findAuthorMessageId(session: Session, callId: string): string | undefined {
  for (const seq of session.surface.nodes) {
    const event = session.events[seq]
    if (event?.type !== 'assistant/message') continue
    if (
      event.data.message.content.some(
        (block) => block.type === 'tool-call' && block.id === callId,
      )
    ) {
      return String(event.data.message.id)
    }
  }
  return undefined
}

export function createCompressTool(ctx: Context, config: DcpConfig) {
  return defineTool({
    name: 'compress',
    description:
      'Compress one or more closed conversation ranges into summary checkpoints. ' +
      'Ranges are half-open [startRef, endRef): startRef is included, endRef is excluded. ' +
      'Use boundary refs visible in context (mNNNN). Only closed, tool-pairing-balanced ranges are accepted. ' +
      'Multiple non-overlapping ranges may be supplied in one call; each is committed independently. ' +
      'Summaries must be plain prose without blockRef markers like [b1].',
    parameters: {
      topic: {
        type: 'string',
        required: true,
        description: 'Short 3-5 word label for the compressed section',
      },
      content: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            startRef: {
              type: 'string',
              required: true,
              description: 'Inclusive start boundary ref, e.g. m0001',
            },
            endRef: {
              type: 'string',
              required: true,
              description: 'Exclusive end boundary ref, e.g. m0007',
            },
            summary: {
              type: 'string',
              required: true,
              description:
                'Complete technical summary injected into the conversation as the checkpoint; must be actual content, not a pointer or placeholder',
            },
          },
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (exec.parent !== undefined) {
        throw new Error(
          'compress cannot be executed from a run_code sub-call; use native tool presentation or /dcp compress',
        )
      }
      if (!exec.agent) throw new Error('compress requires an agent session')
      const session = exec.agent.session
      const callId = String(exec.callId)
      const authorMessageId = findAuthorMessageId(session, callId) ?? 'unknown'
      const result: CompressRangeResult = executeCompressRange(
        session,
        ctx.tokenMeter,
        config,
        args as never,
        {
          compactionId: CompactionId(`dcp-${callId}`),
          compressCallId: callId,
          authorMessageId,
        },
      )
      const warning = result.cleanupWarning
        ? ` (cleanup warning: ${result.cleanupWarning})`
        : ''
      const blockSummary = result.blocks.map((block) => block.blockRef).join(', ')
      const messages = result.blocks.reduce((sum, block) => sum + block.compressedMessages, 0)
      const failedSummary =
        result.failed.length > 0
          ? ` ${result.failed.length} range(s) failed: ${result.failed
              .map((entry) => `${entry.startRef}..${entry.endRef}: ${entry.error}`)
              .join('; ')}`
          : ''
      return `Compressed ${messages} message(s) into ${blockSummary}.${failedSummary}${warning}`
    },
  })
}
