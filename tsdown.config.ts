import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'lib',
  clean: true,
  dts: true,
  outExtension: () => ({ js: '.js', dts: '.d.ts' }),
})
