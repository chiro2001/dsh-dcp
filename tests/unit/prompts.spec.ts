import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/config.js'
import { renderDcpGuidance } from '../../src/prompts/system.js'

describe('dcp system guidance', () => {
  it('renders stable guidance and manual-mode note', () => {
    const config = resolveConfig({})
    const text = renderDcpGuidance(config, false)
    expect(text).toContain('half-open')
    expect(text).toContain('compress')
    expect(text).toContain('<dcp-message-id>bN</dcp-message-id>')
    expect(text).toContain('is only the inline cleanup marker')
    expect(text).not.toContain('Manual mode is active')

    const manual = renderDcpGuidance(config, true)
    expect(manual).toContain('Manual mode is active')
  })
})
