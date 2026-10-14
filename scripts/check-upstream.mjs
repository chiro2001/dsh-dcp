import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const supported = manifest.devDependencies['@deepseek-ai/dsh-agent-loop']
const response = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest', {
  signal: AbortSignal.timeout(15_000),
})
if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
const { version } = await response.json()
console.log(`dsh compatibility: tested=${supported}; upstream latest=${version}`)
if (version !== supported) {
  console.error(
    'Upstream changed. Update the exact dsh dependency family and CLI, then run check-all --coverage --e2e before declaring support.',
  )
  process.exitCode = 1
}
