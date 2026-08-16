import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/config.js'
import { createCompressTool } from '../../src/compress/tool.js'

describe('Code Mode fail-closed (M6.3)', () => {
  it('rejects run_code sub-calls before any DCP work', async () => {
    const tool = createCompressTool({} as never, resolveConfig({}))
    const exec = {
      parent: Symbol('parent-token'),
    } as never
    await expect(
      tool.execute(
        {
          topic: 't',
          content: [{ startRef: 'm0001', endRef: 'm0002', summary: 's' }],
        } as never,
        exec,
      ),
    ).rejects.toThrow(/run_code/)
  })
})
