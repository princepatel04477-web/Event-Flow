import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The dark theme is a token set, not a rewrite — so the one thing that can be
 * checked without a screen is that its text still reads.
 *
 * Two assertions:
 *  1. every COLOUR token the light theme defines is redefined in dark, so no
 *     component falls through to a light value on a dark ground; and
 *  2. each text/surface pair the design actually uses meets its WCAG floor.
 *
 * A browser screenshot would prove more, but it cannot run in this sandbox
 * (see tests/v3-calls-screens.test.ts), and a wrong contrast is arithmetic
 * rather than a judgment call — so it is tested here.
 */

const css = readFileSync(fileURLToPath(new URL('../src/app/globals.css', import.meta.url)), 'utf8')

/** The declarations inside a selector's block. Blocks here are flat. */
function blockDecls(selector: string): Record<string, string> {
  const escaped = selector.replace(/[[\]'=]/g, (c) => `\\${c}`)
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  if (!match) throw new Error(`block not found: ${selector}`)

  const out: Record<string, string> = {}
  for (const m of match[1].matchAll(/--ef-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1].trim()] = m[2].trim()
  }
  return out
}

/** Tokens that are not colours — they have no business being redefined. */
const NON_COLOUR = /^(duration|ease|text|tracking|tabbar|bottombar|spacing|shadow)/

function colourTokenNames(decls: Record<string, string>): string[] {
  return Object.keys(decls).filter((name) => !NON_COLOUR.test(name))
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.trim().replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

/** Text token → the surface tokens it is allowed to sit on. */
const TEXT_ON: Array<[fg: string, bg: string, floor: number]> = [
  ['ink', 'paper', 4.5],
  ['muted', 'paper', 4.5],
  ['subtle', 'paper', 4.5],
  ['ink', 'surface', 4.5],
  ['muted', 'surface', 4.5],
  ['ledger-red', 'paper', 4.5],
  ['ledger-green', 'paper', 4.5],
  ['ledger-amber', 'paper', 4.5],
  ['brand', 'paper', 4.5],
  ['brand', 'surface', 4.5],
  ['ledger-green', 'green-tint', 4.5],
  ['ledger-red', 'red-tint', 4.5],
  ['ledger-amber', 'amber-tint', 4.5],
  ['brand-fg', 'brand', 4.5],
  ['now-fg', 'now', 4.5],
  ['now-muted', 'now', 4.5],
  ['highlight-fg', 'highlight', 4.5],
]

const THEMES: Array<[name: string, base: string, dark: string]> = [
  ['staff light', 'root', '[data-mode=\'dark\']'],
  ['client light', "[data-theme='client']", "[data-theme='client'][data-mode='dark']"],
]

describe('every colour token has a dark value', () => {
  const lightStaff = colourTokenNames(blockDecls(':root'))
  const darkStaff = blockDecls("[data-mode='dark']")

  it.each(lightStaff)('%s is redefined in [data-mode="dark"]', (token) => {
    expect(darkStaff[token], `--ef-${token} missing from the dark block`).toBeDefined()
  })

  it('the client dark block redefines the same set', () => {
    const clientLight = colourTokenNames(blockDecls("[data-theme='client']"))
    const clientDark = blockDecls("[data-theme='client'][data-mode='dark']")
    for (const token of clientLight) {
      expect(clientDark[token], `--ef-${token} missing from the client dark block`).toBeDefined()
    }
  })
})

describe('text meets its floor in every theme', () => {
  for (const [name, lightSel, darkSel] of THEMES) {
    it(`${name}`, () => {
      const light = blockDecls(lightSel)
      const dark = blockDecls(darkSel)

      for (const [mode, tokens] of [
        ['light', light],
        ['dark', dark],
      ] as const) {
        for (const [fg, bg, floor] of TEXT_ON) {
          const fgValue = tokens[fg]
          const bgValue = tokens[bg]
          if (!fgValue || !bgValue) continue
          const ratio = contrast(fgValue, bgValue)
          expect(
            Number(ratio.toFixed(2)),
            `${name} ${mode}: --ef-${fg} on --ef-${bg} is ${ratio.toFixed(2)}:1, floor ${floor}`,
          ).toBeGreaterThanOrEqual(floor)
        }
      }
    })
  }
})
