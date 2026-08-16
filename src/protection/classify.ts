/**
 * Minimal protected-content classification for v0.1 (M2 extends this).
 *
 * @module dsh-dcp/protection/classify
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { DcpConfig } from '../config.js'

const PROTECT_TAG = /<protect>([\s\S]*?)<\/protect>/gi

export interface ProtectedAppendix {
  text: string
  kinds: string[]
}

/** Collect verbatim user messages and <protect> tags from shadowed nodes. */
export function collectProtectedAppendix(
  session: Session,
  shadowedSeqs: readonly number[],
  config: DcpConfig,
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
  }

  return { text: sections.join(''), kinds: [...new Set(kinds)] }
}
