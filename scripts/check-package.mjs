import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const failures = []
const supportedDshVersion = '0.1.2-rc.1'
const expectedPeerCordis = '>=4.0.2 <5.0.0'
const expectedDevVersions = {
  '@deepseek-ai/cordis': '4.0.2',
  '@deepseek-ai/schemastery': '3.18.2',
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

if (failures.length > 0) {
  console.error('check:package FAILED')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('check:package PASSED')
