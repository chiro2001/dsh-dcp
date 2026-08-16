import { describe, expect, it } from 'vitest'

describe('dsh-dcp scaffold', () => {
  it('test harness is wired', () => {
    expect(1 + 1).toBe(2)
  })

  it('package manifest is loadable', async () => {
    const manifest = (await import('../package.json', { with: { type: 'json' } })).default
    expect(manifest.name).toBe('@chiro2001/dsh-dcp')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })
})
