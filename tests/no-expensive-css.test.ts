import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The 60fps contract, as a test (UI4-ARENA-PROMPTS.md §3, F1–F3).
 *
 * The app runs in a WebView on a ₹8,000 Android phone. A frame there is
 * 16.7ms on a slow core, and the three things below are the ones that blow it:
 *
 * - `backdrop-filter` / `backdrop-blur` re-blurs everything behind the element
 *   on every scroll frame. A sticky blurred header did exactly that.
 * - `transition-all` transitions every property that changes, including
 *   layout ones, so a class swap that moves padding animates a re-layout.
 * - transitioning or animating a LAYOUT property (width, height, top, left,
 *   bottom, right, margin, padding, max-height) re-lays-out the page every
 *   frame. Transform and opacity stay on the compositor.
 *
 * A comment line is skipped, so a file may explain why it avoids one of these.
 */

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(tsx|ts|css)$/.test(entry.name)) out.push(full)
  }
  return out
}

const RULES: { name: string; pattern: RegExp }[] = [
  { name: 'backdrop blur', pattern: /backdrop-blur|backdrop-filter|backdropFilter/ },
  { name: 'transition-all', pattern: /\btransition-all\b/ },
  {
    name: 'layout transition',
    pattern: /transition-\[(?:width|height|top|left|bottom|right|margin|padding|max-height|min-height)\b/,
  },
  {
    name: 'layout property in a motion animate/initial/exit object',
    pattern: /\b(?:animate|initial|exit|whileTap|whileHover)=\{\{[^}]*\b(?:width|height|top|left|bottom|right|margin\w*|padding\w*|boxShadow|filter)\s*:/,
  },
]

function isComment(line: string): boolean {
  const s = line.trim()
  return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*') || s.startsWith('{/*')
}

describe('no expensive CSS on the frame path (UI4 §3)', () => {
  const files = walk(SRC)

  for (const rule of RULES) {
    it(`has no ${rule.name}`, () => {
      const hits: string[] = []
      for (const file of files) {
        const lines = fs.readFileSync(file, 'utf-8').split('\n')
        lines.forEach((line, i) => {
          if (!isComment(line) && rule.pattern.test(line)) {
            hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
          }
        })
      }
      expect(hits, `${rule.name} found:\n${hits.join('\n')}`).toEqual([])
    })
  }
})
