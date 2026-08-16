import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freezeMessage } from '@deepseek-ai/dsh-llm/message'
import { mountContractFixture, type ContractFixture } from './fixture.js'
import { buildHistorySession } from './helpers.js'

describe('M3 host contract: surface replacements inside an open turn without step', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('allows tool-result content replacement with an open turn but no open step', () => {
    const { session, seqs } = buildHistorySession(fixture.ctx)
    session.append('turn/start', { turn: 3 })

    const resultEvent = session.events.find((event) => event.seq === seqs.result)
    if (resultEvent?.type !== 'tool/result') throw new Error('result missing')
    const pruned = freezeMessage({
      ...resultEvent.data.message,
      content: [
        {
          ...resultEvent.data.message.content[0],
          content: [{ type: 'text', text: '[deduplicated]' }],
        },
      ],
    } as never)

    expect(() => {
      session.append('compaction/prune', {
        shadowedRange: { start: seqs.result, end: seqs.result },
        shadowedSeqs: [seqs.result],
        shadowedTokenCount: fixture.ctx.tokenMeter.estimateMessage(resultEvent.data.message),
      })
      session.append(
        'tool/result',
        {
          turn: 2,
          step: 1,
          message: pruned,
        },
        {
          surfaceOp: { op: 'replace', start: seqs.result, end: seqs.result },
          sourceEventSeqs: [seqs.result],
        },
      )
    }).not.toThrow()

    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    const text = session
      .deriveMessages()
      .flatMap((message) => message.content)
      .flatMap((block) => (block.type === 'tool-result' ? block.content : []))
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    expect(text).toContain('[deduplicated]')
  })
})
