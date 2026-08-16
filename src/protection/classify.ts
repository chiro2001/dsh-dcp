/**
 * Protected-content classification for v0.1/M2.
 *
 * @module dsh-dcp/protection/classify
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { DcpConfig } from '../config.js'
import { matchesGlob } from './patterns.js'

const PROTECT_TAG = /<protect>([\s\S]*?)<\/protect>/gi

export interface ProtectedAppendix {
  text: string
  kinds: string[]
}

export interface PriorBlock {
  ref: string
  text: string
}

function toolNameOf(session: Session, callId: string): string | undefined {
  for (const event of session.events) {
    if (event.type === 'tool/call' && String(event.data.callId) === callId) {
      return event.data.name
    }
  }
  return undefined
}

function filePathsOf(tool: string, args: string): string[] {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>
    if (tool === 'apply_patch' && typeof parsed.patchText === 'string') {
      return [
        ...parsed.patchText.matchAll(/\*\*\* (?:Add|Delete|Update) File: ([^\n\r]+)/g),
      ].map((match) => match[1]!.trim())
    }
    if (typeof parsed.filePath === 'string') return [parsed.filePath]
    return []
  } catch {
    return []
  }
}

/** Collect verbatim user messages, <protect> tags, protected tool outputs, and prior blocks. */
export function collectProtectedAppendix(
  session: Session,
  shadowedSeqs: readonly number[],
  config: DcpConfig,
  priorBlocks: readonly PriorBlock[] = [],
): ProtectedAppendix {
  const sections: string[] = []
  const kinds: string[] = []

  for (const seq of shadowedSeqs) {
    const event = session.events[seq]
    if (event?.type !== 'user/message') continue
    const texts = event.data.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
    const text = texts.join('\n')
    if (!text.trim()) continue
    if (config.compress.protectUserMessages) {
      sections.push(`\nUser message verbatim:\n${text}`)
      kinds.push('user')
    }
    if (config.compress.protectTags) {
      const protectedTexts: string[] = []
      for (const match of text.matchAll(PROTECT_TAG)) {
        const body = match[1]?.trim()
        if (body) protectedTexts.push(body)
      }
      if (protectedTexts.length > 0) {
        sections.push(`\nProtected prompt information verbatim:\n${protectedTexts.join('\n')}`)
        kinds.push('protect-tag')
      }
    }
    const source = event.data.source as { form?: string }
    if (config.compress.protectedSources.includes(source.form ?? '')) {
      sections.push(`\nProtected source ${source.form} verbatim:\n${text}`)
      kinds.push(`source:${source.form}`)
    }
  }

  for (const seq of shadowedSeqs) {
    const event = session.events[seq]
    if (event?.type !== 'tool/result') continue
    const callId = String(event.data.message.source.callId)
    const tool = toolNameOf(session, callId)
    if (!tool) continue
    const toolCall = session.events.find(
      (candidate) => candidate.type === 'tool/call' && String(candidate.data.callId) === callId,
    )
    const args = toolCall?.type === 'tool/call' ? toolCall.data.arguments : ''
    const protectedByTool = config.compress.protectedTools.includes(tool)
    const protectedByPath = config.protectedFilePatterns.some((pattern) =>
      filePathsOf(tool, args).some((path) => matchesGlob(path, pattern)),
    )
    if (!protectedByTool && !protectedByPath) continue
    const output = event.data.message.content
      .flatMap((block) => (block.type === 'tool-result' ? block.content : []))
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    if (output.trim()) {
      sections.push(`\nProtected tool ${tool} output verbatim:\n${output}`)
      kinds.push(`tool:${tool}`)
    }
  }

  if (priorBlocks.length > 0) {
    sections.push(
      `\nIncluded prior blocks:\n${priorBlocks
        .map((block) => `${block.ref}: ${block.text}`)
        .join('\n')}`,
    )
    kinds.push('prior-blocks')
  }

  return { text: sections.join(''), kinds: [...new Set(kinds)] }
}

/** Hard-protected user forms that must never be shadowed. */
export function hardProtectedForm(form: unknown): boolean {
  return form === 'instructions' || form === 'snapshot'
}
