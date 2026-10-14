import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Plugin } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { mountContractFixture, type ContractFixture } from '../contract/fixture.js'
import * as dcpPlugin from '../../src/index.js'
import { resolveConfig } from '../../src/config.js'

describe('dsh-dcp plugin registration (M1)', () => {
  let fixture: ContractFixture

  beforeEach(async () => {
    fixture = await mountContractFixture()
    await fixture.ctx.plugin(SystemPrompt)
    await fixture.ctx.plugin(ToolRuntime)
    await fixture.ctx.plugin(CommandRuntime)
  })

  afterEach(async () => {
    await fixture.dispose()
  })

  it('registers runtime features and exports Config for loader discovery', async () => {
    await fixture.ctx.plugin(dcpPlugin as unknown as Plugin, resolveConfig({}))

    const compress = fixture.ctx.tools.get('compress')
    expect(compress).toBeDefined()
    expect(compress?.name).toBe('compress')

    const assembly = await fixture.ctx.systemPrompt.assemble()
    const guidance = assembly.sections.find((section) => section.name === 'dcp:guidance')
    expect(guidance?.text).toContain('half-open')

    expect(fixture.ctx.commands).toBeDefined()
    expect(dcpPlugin.Config).toBeDefined()
    expect(dcpPlugin.Config({}).compress.enabled).toBe(true)
  })
})
