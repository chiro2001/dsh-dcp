/**
 * Glob matching for protected file patterns.
 *
 * @module dsh-dcp/protection/patterns
 */

function normalizePath(input: string): string {
  return input.replaceAll('\\', '/')
}

function escapeRegExpChar(ch: string): string {
  return /[\\.^$+{}()|[\]]/.test(ch) ? `\\${ch}` : ch
}

export function matchesGlob(inputPath: string, pattern: string): boolean {
  if (!pattern) return false
  const input = normalizePath(inputPath)
  const pat = normalizePath(pattern)
  let regex = '^'
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i]!
    if (ch === '*') {
      const next = pat[i + 1]
      if (next === '*') {
        const after = pat[i + 2]
        if (after === '/') {
          regex += '(?:.*/)?'
          i += 2
        } else {
          regex += '.*'
          i++
        }
        continue
      }
      regex += '[^/]*'
      continue
    }
    if (ch === '?') {
      regex += '[^/]'
      continue
    }
    regex += escapeRegExpChar(ch)
  }
  regex += '$'
  return new RegExp(regex).test(input)
}
