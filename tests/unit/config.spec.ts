import { describe, expect, it } from 'vitest'
import { resolveConfig, unknownConfigKeys, DCP_CONFIG_DEFAULTS } from '../../src/config.js'

describe('dcp config', () => {
  it('resolves defaults for an empty document', () => {
    const config = resolveConfig({})
    expect(config.enabled).toBe(true)
    expect(config.compress.mode).toBe('range')
    expect(config.compress.maxRangesPerCall).toBe(DCP_CONFIG_DEFAULTS.compress.maxRangesPerCall)
    expect(config.references.transport).toBe('marker')
    expect(config.strategies.purgeErrors.enabled).toBe(false)
  })

  it('rejects minRatio >= maxRatio', () => {
    expect(() => resolveConfig({ nudge: { minRatio: 0.9, maxRatio: 0.8 } })).toThrow(/minRatio/)
  })

  it('rejects non-positive integer bounds', () => {
    expect(() => resolveConfig({ compress: { maxRangesPerCall: 0 } })).toThrow()
    expect(() => resolveConfig({ strategies: { purgeErrors: { turns: 0 } } })).toThrow()
  })

  it('rejects v0.1-unsupported compress mode', () => {
    expect(() => resolveConfig({ compress: { mode: 'message' } })).toThrow()
  })

  it('detects unknown config keys', () => {
    expect(unknownConfigKeys({ compress: { summaryBuffer: true } })).toEqual([
      'compress.summaryBuffer',
    ])
    expect(unknownConfigKeys({ permission: 'allow' })).toEqual(['permission'])
    expect(unknownConfigKeys({ enabled: true })).toEqual([])
  })
})
