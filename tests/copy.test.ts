import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The copy guard for the "Speak Like an Indian Event Team" series.
 *
 * It scans the v2 screens and the shared components for the phrases
 * `docs/COPY-INDIA.md` §2 bans, and fails if one appears in a line a person
 * could read. Comment lines are skipped — a code comment may name an old
 * string when it explains why it changed. A line that genuinely has to hold a
 * banned word (a regex, an import path, a value that is not screen text) can
 * opt out with `// copy-ok: <reason>` on the same line.
 *
 * Run it on its own with `npm run test:copy`.
 */

const ROOTS = ['src/app/(app)/v2', 'src/components']

/** Nothing under here is user-facing copy. */
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__'])

const BANNED: string[] = [
  // V5 — American idioms.
  'all set',
  'good to go',
  'heads up',
  'swing by',
  'no worries',
  'awesome',
  'oops',
  'with a bed',
  // V7 — no literary or cute words.
  'journey',
  'yay',
  'magic ',
  // V6 — old clerical Indian English.
  'kindly',
  'do the needful',
  'revert back',
  'prepone',
  // The L-series' own reversals.
  'right now',
  'still to call',
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...walk(join(dir, entry.name)))
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

function isComment(line: string): boolean {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')
}

describe('copy — banned phrases', () => {
  it('has no banned phrase on a readable line', () => {
    const violations: string[] = []

    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const lines = readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, index) => {
          if (isComment(line) || line.includes('copy-ok:')) return
          const lower = line.toLowerCase()
          for (const phrase of BANNED) {
            if (lower.includes(phrase)) {
              violations.push(`${relative(process.cwd(), file)}:${index + 1}  "${phrase}"  ${line.trim()}`)
            }
          }
        })
      }
    }

    expect(violations, `Banned copy:\n${violations.join('\n')}`).toEqual([])
  })
})
