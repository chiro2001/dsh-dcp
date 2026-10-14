import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const failures = []
const supportedDshVersion = manifest.devDependencies['@deepseek-ai/dsh-agent-loop']
const expectedPeerCordis = '~4.0.4'
const expectedDevVersions = {
  '@deepseek-ai/cordis': '4.0.4',
  '@deepseek-ai/schemastery': '3.18.4',
}

const peerCordis = manifest.peerDependencies?.['@deepseek-ai/cordis']
if (peerCordis !== expectedPeerCordis) {
  failures.push(
    `peer @deepseek-ai/cordis must match ${expectedPeerCordis}, got ${peerCordis ?? 'missing'}`,
  )
}

for (const [dependency, expected] of Object.entries(expectedDevVersions)) {
  const actual = manifest.devDependencies?.[dependency]
  if (actual !== expected) {
    failures.push(
      `dev dependency ${dependency} must match ${expected}, got ${actual ?? 'missing'}`,
    )
  }
}

for (const [dependency, version] of Object.entries(manifest.peerDependencies ?? {})) {
  if (dependency.startsWith('@deepseek-ai/dsh-') && version !== supportedDshVersion) {
    failures.push(
      `peer ${dependency} must match supported dsh ${supportedDshVersion}, got ${version}`,
    )
  }
}

for (const [dependency, version] of Object.entries(manifest.devDependencies ?? {})) {
  if (dependency.startsWith('@deepseek-ai/dsh-') && version !== supportedDshVersion) {
    failures.push(
      `dev dependency ${dependency} must match supported dsh ${supportedDshVersion}, got ${version}`,
    )
  }
}

for (const [subpath, target] of Object.entries(manifest.exports)) {
  if (subpath === './package.json') continue
  if (typeof target === 'string' && !existsSync(resolve(root, target))) {
    failures.push(`export ${subpath} -> ${target} missing`)
  }
  if (typeof target === 'object' && target !== null) {
    for (const value of Object.values(target)) {
      if (typeof value === 'string' && !existsSync(resolve(root, value))) {
        failures.push(`export ${subpath} -> ${value} missing`)
      }
    }
  }
}

const patch = manifest.dsh?.bundle?.patch
if (!patch) {
  failures.push('dsh.bundle.patch missing')
} else if (!existsSync(resolve(root, patch))) {
  failures.push(`dsh.bundle.patch -> ${patch} missing`)
}

if (failures.length === 0) {
  try {
    const entry = await import('@chiro2001/dsh-dcp')
    if (entry.name !== 'dsh-dcp' || typeof entry.apply !== 'function' || !entry.Config) {
      failures.push('built entry must expose name, apply, and Config')
    }
    // Compile as a consumer, independently of src/tests augmentations. A full
    // project typecheck can hide missing producer kinds in the shipped d.ts.
    execFileSync(
      'pnpm',
      [
        'exec',
        'tsc',
        '--ignoreConfig',
        '--noEmit',
        '--target',
        'es2023',
        '--module',
        'nodenext',
        '--strict',
        '--skipLibCheck',
        'tests/fixtures/package-consumer.ts',
      ],
      { cwd: root, stdio: 'pipe' },
    )
  } catch (error) {
    failures.push(`built entry/declarations: ${error.stdout?.toString() || error.message}`)
  }
}

if (failures.length > 0) {
  console.error('check:package FAILED')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('check:package PASSED')
