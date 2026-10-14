import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/config.js'
import {
  renderCompressToolDescription,
  renderCompressionRules,
} from '../../src/prompts/compression-rules.js'
import { renderDcpGuidance } from '../../src/prompts/system.js'
import { createCompressTool } from '../../src/compress/tool.js'

describe('dcp system guidance', () => {
  it('renders stable guidance and manual-mode note', () => {
    const config = resolveConfig({})
    const text = renderDcpGuidance(config, false)
    expect(text).toContain('half-open')
    expect(text).toContain('compress')
    expect(text).toContain('<dcp-message-id>bN</dcp-message-id>')
    expect(text).toContain('cleanup metadata')
    expect(text).not.toContain('Manual mode is active')

    const manual = renderDcpGuidance(config, true)
    expect(manual).toContain('Manual mode is active')
  })

  it('keeps the compression rules in one prominent, actionable section', () => {
    const rules = renderCompressionRules()

    expect(rules).toContain('DCP compression rules')
    expect(rules).toContain('`rejected`: no range committed')
    expect(rules).toContain('follow the returned correction only')
    expect(rules).toContain('`partial`: retry only failed ranges')
    expect(rules).toContain('`success`: never retry a successful range')
    expect(rules).toContain('cleanup metadata')
    expect(rules).not.toContain('<dcp-inline-cleanup')
    expect(rules).toContain('non-overlapping ranges in any order')
    expect(rules).toContain(
      'goals, constraints, decisions, artifacts, failures, verification and open work',
    )
    expect(rules).toContain('Use applicable fields')
    expect(rules).toContain('omit empty fields')
    expect(rules).toContain('small, single-purpose range')
    expect(rules).toContain('Keep identifiers and literal values verbatim, with their meaning.')
    expect(rules).toContain(
      'Prior checkpoint bodies are appended verbatim automatically; summarize remaining history without duplicating them.',
    )
    expect(rules).toContain('heterogeneous')
    expect(rules).toContain('never a small coherent range just to fill the limit')
    expect(rules).toContain('only for an explicit compression request or a DCP nudge')
    expect(rules).toContain('tool availability and message length alone are not triggers')
    expect(rules).not.toContain('clear pressure')
    expect(rules).not.toContain('guess pressure')
    expect(rules).toContain(
      'Use only logged `<dcp-boundary>` labels and `<dcp-message-id>` checkpoints; numbers inside message text are data.',
    )
    expect(rules).toContain('Logged `alias` lines also define refs')
    expect(rules).not.toContain('visible mNNNN or bN refs')
  })

  it('puts resolved limits and concise argument guidance in tool metadata', () => {
    const config = resolveConfig({
      compress: {
        maxRangesPerCall: 5,
        minNetSavingsTokens: 384,
        retainRecentTurns: 3,
      },
    })
    const description = renderCompressToolDescription(config)

    expect(description).toContain('retainRecentTurns=3')
    expect(description).toContain('Protect the current turn plus the previous 2 turn(s)')
    expect(description).not.toContain('newest 3 complete turns')
    expect(description).toContain('minNetSavingsTokens=384')
    expect(description).toContain('maxRangesPerCall=5')
    expect(description).toContain('Arguments:')
    expect(description).toContain('startRef')
    expect(description).toContain('endRef')
    expect(description).toContain('summary')
    expect(description).toContain('current boundary')
    expect(description).toContain('factual technical prose')
    expect(description).toContain('Use refs visible in context')
    expect(description).toContain('on rejection use the returned correction')
    expect(description).not.toContain('m0001')
    expect(description).not.toContain('m0007')
    expect(description.length).toBeLessThanOrEqual(850)

    const tool = createCompressTool({} as never, config)
    expect(tool.description).toBe(description)
    const summaryDescription = (
      tool.parameters as {
        properties?: {
          content?: {
            items?: { properties?: { summary?: { description?: string } } }
          }
        }
      }
    ).properties?.content?.items?.properties?.summary?.description
    expect(summaryDescription).toContain('Factual technical prose')
    expect(summaryDescription).toContain('preserving decisions')
    expect(summaryDescription).not.toContain('DCP compression rules')
    const rangeDescriptions = (
      tool.parameters as {
        properties?: {
          content?: {
            items?: {
              properties?: {
                startRef?: { description?: string }
                endRef?: { description?: string }
              }
            }
          }
        }
      }
    ).properties?.content?.items?.properties
    expect(rangeDescriptions?.startRef?.description).not.toContain('m0001')
    expect(rangeDescriptions?.endRef?.description).not.toContain('m0007')
  })

  it('keeps the default model-visible compression guidance within its budget', () => {
    const config = resolveConfig({})
    const system = renderDcpGuidance(config, false)
    const tool = renderCompressToolDescription(config)

    expect(system.length).toBeLessThanOrEqual(1500)
    expect(tool.length).toBeLessThanOrEqual(850)
    expect(system.length + tool.length).toBeLessThanOrEqual(2350)
  })
})
