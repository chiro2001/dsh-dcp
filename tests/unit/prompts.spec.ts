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
    expect(rules).toContain('rejected')
    expect(rules).toContain('no range committed')
    expect(rules).toContain('partial')
    expect(rules).toContain('retry only failed ranges')
    expect(rules).toContain('success')
    expect(rules).toContain('never retry a successful range')
    expect(rules).toContain('post-execution rewrite')
    expect(rules).not.toContain('post-commit rewrite')
    expect(rules).toContain('No old-to-new ordering is required')
    expect(rules).not.toContain('Do not sort ranges')
    expect(rules).toContain('Execute the returned correction only')
    expect(rules).not.toContain('safer, smaller, or older')
    expect(rules).toContain('Goal:')
    expect(rules).toContain('Open work:')
    expect(rules).toContain('applicable fields')
    expect(rules).toContain('Omit empty fields')
    expect(rules).toContain('small, single-purpose range')
    expect(rules).not.toContain('write "none"')
    expect(rules).toContain('heterogeneous')
    expect(rules).toContain('do not split a small coherent range')
    expect(rules).toContain('Trigger:')
    expect(rules).toContain('explicit user request')
    expect(rules).toContain('DCP nudge')
    expect(rules).toContain('tool availability alone is not a trigger')
  })

  it('puts resolved limits and the first-pass call template in tool metadata', () => {
    const config = resolveConfig({
      compress: {
        maxRangesPerCall: 5,
        minNetSavingsTokens: 384,
        retainRecentTurns: 3,
      },
    })
    const description = renderCompressToolDescription(config)

    expect(description).toContain('retainRecentTurns=3')
    expect(description).toContain('minNetSavingsTokens=384')
    expect(description).toContain('maxRangesPerCall=5')
    expect(description).toContain('"startRef": "<CURRENT_CLOSED_START_REF>"')
    expect(description).toContain('"endRef": "<CURRENT_CLOSED_END_REF>"')
    expect(description).toContain('"summary"')
    expect(description).toContain('Call template (use applicable fields)')
    expect(description).toContain('preserve facts and do not omit them to reach savings')
    expect(description).toContain('applicable fields')
    expect(description).toContain('Omit empty fields')
    expect(description).not.toContain('all seven fields')
    expect(description).not.toContain('mechanically write "none"')
    expect(description).not.toContain('m0001')
    expect(description).not.toContain('m0007')
    expect(description).toContain('Execute the returned correction only')
    expect(description.length).toBeLessThanOrEqual(1300)

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
    expect(summaryDescription).toContain('applicable')
    expect(summaryDescription).toContain('small, single-purpose')
    expect(summaryDescription).not.toContain('Include Goal, Constraints')
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

    expect(system.length).toBeLessThanOrEqual(2200)
    expect(tool.length).toBeLessThanOrEqual(1300)
    expect(system.length + tool.length).toBeLessThanOrEqual(3500)
  })
})
