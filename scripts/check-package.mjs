import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const failures = []

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
