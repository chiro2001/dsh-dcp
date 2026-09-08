/**
 * Model-facing `compress` tool registration (exclusive, host approval).
 *
 * @module dsh-dcp/compress/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { Session } from '@deepseek-ai/dsh-session'
import type { DcpConfig } from '../config.js'
import { executeCompressRange } from './pipeline.js'
import { formatCompressFailure, formatCompressResult } from './result.js'
import { classifyCompressToolFailure } from './schema.js'
import { renderCompressToolDescription } from '../prompts/compression-rules.js'

interface ExecutionOutcome {
  callId: string
  token: ToolExecutionToken
  result: ReturnType<typeof executeCompressRange>
}

export function findAuthorMessageId(session: Session, callId: string): string | undefined {
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq)
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
  // The same tool definition serves many calls.  Keep each successful
  // pipeline outcome tied to the registry-owned execution identity so a
  // later policy failure cannot accidentally report another call's blocks.
  const outcomesByExecution = new WeakMap<object, ExecutionOutcome>()

  return defineTool({
    name: 'compress',
    description: renderCompressToolDescription(config),
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
              description:
                'Current closed start boundary ref from context; do not copy a literal example',
            },
            endRef: {
              type: 'string',
              required: true,
              description:
                'Current closed exclusive end boundary ref from context; do not copy a literal example',
            },
            summary: {
              type: 'string',
              required: true,
              description:
                'Technical summary injected as the checkpoint. For substantial ranges use applicable Goal, Constraints, Decisions, Artifacts, Failures, Verification, and Open work fields; for a small, single-purpose range use compact high-fidelity prose. Omit empty fields and never mechanically fill "none", use a pointer, or omit facts.',
            },
          },
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    finalizeContent(exec, result) {
      const stored = outcomesByExecution.get(exec)
      try {
        if (!result.isError) return undefined
        if (
          stored !== undefined &&
          stored.callId === String(exec.callId) &&
          stored.token === exec.token
        ) {
          // The compaction already happened.  A downstream policy error must
          // remain an error, but its text must describe the real committed
          // blocks so the model never retries an already-authoritative range.
          return [{ type: 'text', text: formatCompressResult(stored.result) }]
        }
        return [
          {
            type: 'text',
            text: formatCompressFailure(
              exec.arguments,
              result.error,
              classifyCompressToolFailure(result.error),
            ),
          },
        ]
      } finally {
        // Finalization is the last point at which the execution-local outcome
        // is needed.  Do not retain a completed call in the shared definition.
        outcomesByExecution.delete(exec)
      }
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
      const result = executeCompressRange(session, ctx.tokenMeter, config, args as never, {
        compactionId: CompactionId(`dcp-${callId}`),
        compressCallId: callId,
        authorMessageId,
      })
      outcomesByExecution.set(exec as ToolExecution, {
        callId,
        token: exec.token,
        result,
      })
      return formatCompressResult(result)
    },
  })
}
