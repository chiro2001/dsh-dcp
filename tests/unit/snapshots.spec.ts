import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/config.js'
import { renderDcpGuidance } from '../../src/prompts/system.js'
import { renderHelp } from '../../src/commands/help.js'
import { buildCheckpointText } from '../../src/compress/prepare.js'

describe('text snapshots (M6.0)', () => {
  it('system guidance and help stay stable', () => {
    const config = resolveConfig({})
    expect(renderDcpGuidance(config, false)).toMatchSnapshot('guidance-auto')
    expect(renderDcpGuidance(config, true)).toMatchSnapshot('guidance-manual')
    expect(renderHelp()).toMatchSnapshot('help')
    expect(buildCheckpointText('b1', 'summary')).toMatchSnapshot('checkpoint')
  })
})
