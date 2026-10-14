import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const repo = process.cwd()
const runId = '2026-10-14T10-01-50-936Z'
const runRoot = resolve(repo, 'docs/evaluation-runs', runId)
const jobsRoot = resolve(repo, '.tmp-vitest/evaluation-setup/jobs')
const secret = process.env.DEEPSEEK_API_KEY

function print(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (!secret) {
  print({
    checkedFiles: 0,
    secretDetected: null,
    count: null,
    hashes: [],
    unableToCheck: 'DEEPSEEK_API_KEY is unavailable; no scan was performed',
  })
  process.exitCode = 2
} else {
  const roots = []
  let scanIncomplete = false
  let matchingJobDirs = 0
  if (existsSync(runRoot)) roots.push(runRoot)
  else scanIncomplete = true
  if (existsSync(jobsRoot)) {
    for (const entry of readdirSync(jobsRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        entry.name.startsWith(`dsh-pilot-${runId}`)
      ) {
        matchingJobDirs++
        roots.push(resolve(jobsRoot, entry.name))
      }
    }
  } else scanIncomplete = true
  if (matchingJobDirs === 0) scanIncomplete = true

  const files = new Set()
  function visit(path) {
    let stat
    try {
      stat = lstatSync(path)
    } catch {
      scanIncomplete = true
      return
    }
    if (stat.isFile()) {
      files.add(path)
      return
    }
    if (!stat.isDirectory()) return
    let entries
    try {
      entries = readdirSync(path, { withFileTypes: true })
    } catch {
      scanIncomplete = true
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) visit(resolve(path, entry.name))
      else if (entry.isFile()) files.add(resolve(path, entry.name))
    }
  }
  for (const root of roots) visit(root)

  const needle = Buffer.from(secret, 'utf8')
  const hashes = []
  let count = 0
  const hasSecret = (bytes) => bytes.indexOf(needle) !== -1
  for (const path of [...files].toSorted()) {
    try {
      const bytes = readFileSync(path)
      const entry = {
        path: relative(repo, path),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }
      let detected = hasSecret(bytes)
      if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const expanded = gunzipSync(bytes)
        entry.uncompressedSha256 = createHash('sha256').update(expanded).digest('hex')
        detected ||= hasSecret(expanded)
      }
      if (detected) count++
      hashes.push(entry)
    } catch {
      scanIncomplete = true
    }
  }

  print({
    checkedFiles: hashes.length,
    secretDetected: count > 0 ? true : scanIncomplete ? null : false,
    count: scanIncomplete ? null : count,
    hashes,
    ...(scanIncomplete ? { unableToCheck: 'The requested scope could not be fully scanned' } : {}),
  })
  if (scanIncomplete) process.exitCode = 3
}
