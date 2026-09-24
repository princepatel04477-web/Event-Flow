import { describe, expect, it } from 'vitest'

import {
  BUDGETS,
  BUDGET_SEVERITY,
  CPU_THROTTLE_RATE,
  METRICS,
  PROFILES,
  VIEWPORT,
  failures,
  formatBytes,
  formatMs,
  gateExitCode,
  grade,
  gradeRun,
  gradeScreen,
  parseArgs,
  percentile,
  profilesFor,
  renderMarkdown,
  screenCatalog,
  selectScreens,
  summarize,
  summarizeChunks,
  topChunks,
  warnings,
} from '../scripts/perf-core.mjs'

/**
 * The arithmetic behind `scripts/latency.mjs`, tested without a browser.
 *
 * This file is the reason the runner can be trusted in an environment where the
 * browser cannot start: the numbers a measurement produces are only meaningful
 * if the function that turns them into a verdict is itself correct, and that
 * function is pure.
 */

describe('percentile', () => {
  it('returns null for no samples rather than zero', () => {
    expect(percentile([], 50)).toBeNull()
  })

  it('returns the only sample for any percentile', () => {
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 95)).toBe(42)
  })

  it('is nearest-rank, so every answer is a sample that actually happened', () => {
    const samples = [10, 20, 30, 40, 50]
    expect(percentile(samples, 50)).toBe(30)
    expect(percentile(samples, 95)).toBe(50)
    expect(percentile(samples, 100)).toBe(50)
    expect(percentile(samples, 0)).toBe(10)
  })

  it('sorts before ranking, so the input order does not change the answer', () => {
    expect(percentile([50, 10, 40, 30, 20], 50)).toBe(30)
  })

  it('rounds the rank up, so a p95 of 20 samples is the 19th', () => {
    const samples = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(percentile(samples, 95)).toBe(19)
  })

  it('rejects a percentile outside 0-100 instead of silently clamping', () => {
    expect(() => percentile([1, 2], 101)).toThrow(/0-100/)
    expect(() => percentile([1, 2], -1)).toThrow(/0-100/)
    expect(() => percentile([1, 2], Number.NaN)).toThrow(/0-100/)
  })
})

describe('summarize', () => {
  it('reports n, p50, p95 and the extremes', () => {
    expect(summarize([100, 200, 300, 400, 500])).toEqual({
      n: 5,
      p50: 300,
      p95: 500,
      min: 100,
      max: 500,
    })
  })

  it('drops null and NaN samples instead of counting them as zero', () => {
    // Two real samples: nearest-rank p50 is the first of them, not their mean.
    expect(summarize([100, null, Number.NaN, 200])).toEqual({
      n: 2,
      p50: 100,
      p95: 200,
      min: 100,
      max: 200,
    })
  })

  it('answers "no samples" for an empty or missing list', () => {
    expect(summarize([])).toEqual({ n: 0, p50: null, p95: null, min: null, max: null })
    expect(summarize(undefined)).toEqual({ n: 0, p50: null, p95: null, min: null, max: null })
  })
})

describe('grade', () => {
  it('passes a p50 at or under budget', () => {
    const verdict = grade('tapToFirstChange', summarize([100, 110, 120]))
    expect(verdict.verdict).toBe('pass')
    expect(verdict.over).toBe(false)
    expect(verdict.budget).toBe(BUDGETS.tapToFirstChange)
  })

  it('fails a gate metric over budget', () => {
    const verdict = grade('tapToContent', summarize([200, 210, 220]))
    expect(verdict.verdict).toBe('fail')
    expect(verdict.over).toBe(true)
    expect(verdict.severity).toBe('gate')
  })

  it('grades the cold load as a warning, because SPEC-PERF calls it informational', () => {
    const verdict = grade('coldFirstLoad', summarize([3000, 3100, 3200]))
    expect(verdict.verdict).toBe('warn')
    expect(verdict.severity).toBe('warn')
    expect(failures([verdict])).toEqual([])
    expect(warnings([verdict])).toHaveLength(1)
  })

  it('grades the p50, not the p95', () => {
    // Four fast runs and one slow one: p50 fast, p95 over budget.
    const verdict = grade('tapToFirstChange', summarize([50, 60, 70, 80, 900]))
    expect(verdict.p50).toBe(70)
    expect(verdict.p95).toBe(900)
    expect(verdict.verdict).toBe('pass')
  })

  it('reports "not measured" for a metric with no samples, and does not call it a pass', () => {
    const verdict = grade('saveToShownDone', summarize([]))
    expect(verdict.verdict).toBe('not-measured')
    expect(verdict.over).toBe(false)
    expect(verdict.p50).toBeNull()
    expect(failures([verdict])).toEqual([])
  })

  it('refuses a metric it does not know, rather than guessing a budget', () => {
    expect(() => grade('tapToVibes', summarize([1]))).toThrow(/unknown metric/)
  })

  it('has a severity for every budget', () => {
    for (const metric of METRICS as Array<keyof typeof BUDGETS>) {
      expect(BUDGET_SEVERITY[metric], metric).toBeDefined()
      expect(BUDGETS[metric], metric).toBeGreaterThan(0)
    }
  })
})

describe('gradeRun', () => {
  const screens = [
    {
      label: 'Rooms',
      profile: '4g',
      metrics: {
        coldFirstLoad: summarize([2000, 2100]),
        tapToFirstChange: summarize([40, 50]),
        tapToContent: summarize([80, 90]),
        saveToShownDone: summarize([100, 110]),
      },
    },
    {
      label: 'Hampers',
      profile: '4g',
      metrics: {
        coldFirstLoad: summarize([2600, 2700]),
        tapToFirstChange: summarize([300, 310]),
        tapToContent: summarize([400]),
        saveToShownDone: summarize([]),
      },
      reasons: { saveToShownDone: 'no reversible write' },
    },
  ]

  it('produces one row per screen per metric, in report order', () => {
    const rows = gradeRun(screens)
    expect(rows).toHaveLength(2 * METRICS.length)
    expect(rows.slice(0, METRICS.length).map((r) => r.metric)).toEqual(METRICS)
    expect(rows[0].screen).toBe('Rooms')
    expect(rows[0].profile).toBe('4g')
  })

  it('fails only the gated misses and warns on the informational one', () => {
    const rows = gradeRun(screens)
    expect(failures(rows).map((r) => `${r.screen}/${r.metric}`)).toEqual([
      'Hampers/tapToFirstChange',
      'Hampers/tapToContent',
    ])
    expect(warnings(rows).map((r) => `${r.screen}/${r.metric}`)).toEqual([
      'Hampers/coldFirstLoad',
    ])
  })

  it('carries the reason a metric has no number onto its row', () => {
    const row = gradeRun(screens).find((r) => r.screen === 'Hampers' && r.metric === 'saveToShownDone')
    expect(row?.verdict).toBe('not-measured')
    expect(row?.reason).toBe('no reversible write')
  })

  it('grades a screen alone with gradeScreen', () => {
    expect(gradeScreen(screens[0])).toHaveLength(METRICS.length)
  })
})

describe('gateExitCode', () => {
  const screen = (
    label: string,
    metrics: Record<string, ReturnType<typeof summarize>>,
  ) => ({ label, profile: '4g', metrics })

  it('exits 0 when every gated budget is inside its limit', () => {
    const rows = gradeRun([
      screen('Rooms', {
        tapToFirstChange: summarize([40, 50]),
        tapToContent: summarize([80, 90]),
        saveToShownDone: summarize([100, 110]),
        coldFirstLoad: summarize([2100]),
      }),
    ])
    expect(rows.every((r) => r.verdict === 'pass')).toBe(true)
    expect(gateExitCode(rows)).toBe(0)
  })

  it.each(['tapToFirstChange', 'tapToContent', 'saveToShownDone'])(
    'exits 1 when %s misses its 120 ms budget',
    (metric) => {
      const rows = gradeRun([screen('Rooms', { [metric]: summarize([121]) })])
      expect(failures(rows).map((r) => r.metric)).toEqual([metric])
      expect(gateExitCode(rows)).toBe(1)
    },
  )

  it('exits 0 when only the cold load is over budget — that one is informational', () => {
    const rows = gradeRun([
      screen('Rooms', {
        coldFirstLoad: summarize([4000]),
        tapToFirstChange: summarize([30]),
        tapToContent: summarize([40]),
        saveToShownDone: summarize([50]),
      }),
    ])
    expect(warnings(rows).map((r) => r.metric)).toEqual(['coldFirstLoad'])
    expect(failures(rows)).toEqual([])
    expect(gateExitCode(rows)).toBe(0)
  })

  it('exits 1 when nothing was measured, because no failures is not a pass', () => {
    // The failure mode: a broken login or an unreachable screen produces a table
    // of `not measured` rows with zero failures, and a naive gate calls that
    // green about a run that produced no numbers at all.
    const rows = gradeRun([
      screen('Today', {}),
      screen('Rooms', {}),
    ])
    expect(rows.every((r) => r.verdict === 'not-measured')).toBe(true)
    expect(failures(rows)).toEqual([])
    expect(gateExitCode(rows)).toBe(1)
  })

  it('exits 0 when at least one metric was measured and none failed', () => {
    // One measured, several not: a real number exists, so the gate reports on
    // the budgets it could see. Only a run with NO numbers at all is the false
    // pass this refuses.
    const rows = gradeRun([screen('Rooms', { tapToFirstChange: summarize([60]) })])
    expect(rows.some((r) => r.verdict === 'not-measured')).toBe(true)
    expect(gateExitCode(rows)).toBe(0)
  })

  it('exits 1 for an empty run, which measured nothing by definition', () => {
    expect(gateExitCode([])).toBe(1)
  })

  it('takes the p50, so a single slow tail run does not fail a screen that is fast', () => {
    const rows = gradeRun([
      screen('Rooms', { tapToFirstChange: summarize([50, 60, 70, 80, 900]) }),
    ])
    expect(rows.find((r) => r.metric === 'tapToFirstChange')?.p95).toBe(900)
    expect(gateExitCode(rows)).toBe(0)
  })
})

describe('screenCatalog', () => {
  it('covers the seven job screens SPEC-PERF names', () => {
    expect(screenCatalog('SAMPLE2026').map((s) => s.label)).toEqual([
      'Today',
      'Calls',
      'Rooms',
      'Check-in',
      'Hampers',
      'Arrivals',
      'Guests search',
    ])
  })

  it('builds every path and donor from the event code, absolutely', () => {
    for (const screen of screenCatalog('ABC123')) {
      expect(screen.path.startsWith('/ABC123'), screen.label).toBe(true)
      expect(screen.donors.length, screen.label).toBeGreaterThan(0)
      for (const donor of screen.donors) {
        expect(donor.startsWith('/ABC123'), `${screen.label} donor ${donor}`).toBe(true)
        expect(donor, `${screen.label} donor must not be the screen itself`).not.toBe(screen.path)
      }
    }
  })

  it('starts each tap from a screen that exists, never from nowhere', () => {
    const screens = screenCatalog('E1')
    const paths = new Set(screens.map((s) => s.path))
    // `/{event}/hamper` is allowed as a donor without being a measured screen: it
    // is where the v3 Hampers TAB points, and the screen the brief names for that
    // job is the v2 deliveries board at `/{event}/hospitality/deliveries`. The
    // harness tries the tab's own destination on the way to the real board.
    paths.add('/E1/hamper')
    for (const screen of screens) {
      for (const donor of screen.donors) {
        expect(paths.has(donor), `${screen.label} starts from unlisted ${donor}`).toBe(true)
      }
    }
  })

  it('tries each donor only once', () => {
    for (const screen of screenCatalog('E1')) {
      expect(new Set(screen.donors).size, screen.label).toBe(screen.donors.length)
    }
  })

  it('names how to reach every screen, and only in the two supported ways', () => {
    for (const screen of screenCatalog('E1')) {
      expect(['tab', 'link', 'search'], screen.label).toContain(screen.tap.kind)
      if (screen.tap.kind === 'link') {
        expect(screen.tap.endsWith.startsWith('/')).toBe(true)
      } else {
        expect('endsWith' in screen.tap, screen.label).toBe(false)
      }
    }
  })

  it('states a reason for every screen whose save is not measured', () => {
    for (const screen of screenCatalog('E1')) {
      const reason = screen.saveReason ?? ''
      if (screen.save) {
        expect(reason, screen.label).toBe('')
      } else {
        // A blank reason is the failure mode this asserts against: a screen with
        // no number must say why, or the blank reads as a pass.
        expect(reason, screen.label).not.toBe('')
        expect(reason.length, screen.label).toBeGreaterThan(20)
      }
    }
  })

  it('has unique labels, so --screens is unambiguous', () => {
    const labels = screenCatalog('E1').map((s) => s.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('selectScreens', () => {
  const catalog = screenCatalog('E1')

  it('returns the whole catalogue for no selection', () => {
    expect(selectScreens(catalog, null)).toHaveLength(catalog.length)
    expect(selectScreens(catalog, [])).toHaveLength(catalog.length)
  })

  it('keeps catalogue order, not the order the labels were typed', () => {
    expect(selectScreens(catalog, ['Rooms', 'Today']).map((s) => s.label)).toEqual(['Today', 'Rooms'])
  })

  it('names the unknown labels instead of silently measuring nothing', () => {
    expect(() => selectScreens(catalog, ['Rooms', 'Nope'])).toThrow(/Nope/)
  })
})

describe('parseArgs', () => {
  it('defaults BASE to localhost:3000 and every other knob to the spec', () => {
    expect(parseArgs([], {})).toEqual({
      base: 'http://localhost:3000',
      runs: 5,
      profile: 'both',
      out: 'e2e/latency-results.json',
      md: 'docs/LATENCY.md',
      screens: null,
      seed: true,
      help: false,
    })
  })

  it('takes BASE from the environment, as SPEC-PERF names it', () => {
    expect(parseArgs([], { BASE: 'http://localhost:3100' }).base).toBe('http://localhost:3100')
  })

  it('lets --base win over the environment and strips a trailing slash', () => {
    expect(parseArgs(['--base', 'https://nuvent-five.vercel.app/'], { BASE: 'http://x' }).base).toBe(
      'https://nuvent-five.vercel.app',
    )
  })

  it('accepts every documented flag', () => {
    const opts = parseArgs([
      '--runs',
      '3',
      '--profile',
      '4g',
      '--out',
      'x.json',
      '--md',
      'y.md',
      '--screens',
      'Rooms, Hampers',
      '--no-seed',
    ])
    expect(opts.runs).toBe(3)
    expect(opts.profile).toBe('4g')
    expect(opts.out).toBe('x.json')
    expect(opts.md).toBe('y.md')
    expect(opts.screens).toEqual(['Rooms', 'Hampers'])
    expect(opts.seed).toBe(false)
  })

  it('rejects a run count that is not a usable integer', () => {
    expect(() => parseArgs(['--runs', '0'])).toThrow(/1-50/)
    expect(() => parseArgs(['--runs', '51'])).toThrow(/1-50/)
    expect(() => parseArgs(['--runs', '2.5'])).toThrow(/1-50/)
    expect(() => parseArgs(['--runs', 'five'])).toThrow(/1-50/)
  })

  it('rejects an unknown profile and an unknown flag', () => {
    expect(() => parseArgs(['--profile', 'edge'])).toThrow(/4g, venue-wifi or both/)
    expect(() => parseArgs(['--fast'])).toThrow(/unknown argument/)
  })

  it('rejects a flag with no value instead of swallowing the next flag', () => {
    expect(() => parseArgs(['--base', '--runs', '3'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--base'])).toThrow(/needs a value/)
  })

  it('rejects a base URL that is not http(s)', () => {
    expect(() => parseArgs(['--base', 'localhost:3000'])).toThrow(/http/)
  })

  it('recognises --help', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
  })
})

describe('profilesFor', () => {
  it('returns both profiles for "both", in the spec order', () => {
    expect(profilesFor('both').map((p) => p.name)).toEqual(['4g', 'venue-wifi'])
  })

  it('carries the exact RTT and bandwidth SPEC-PERF names', () => {
    const fourG = PROFILES.find((p) => p.name === '4g')
    const wifi = PROFILES.find((p) => p.name === 'venue-wifi')
    expect(fourG).toMatchObject({ latencyMs: 150, downMbps: 4 })
    expect(wifi).toMatchObject({ latencyMs: 300, downMbps: 1.5 })
  })

  it('returns one profile for a named one and throws otherwise', () => {
    expect(profilesFor('4g')).toHaveLength(1)
    expect(() => profilesFor('3g')).toThrow(/no such profile/)
  })
})

describe('formatting', () => {
  it('prints a sub-second measurement in ms and a longer one in seconds', () => {
    expect(formatMs(0)).toBe('0 ms')
    expect(formatMs(119.4)).toBe('119 ms')
    expect(formatMs(999)).toBe('999 ms')
    expect(formatMs(1000)).toBe('1.00 s')
    expect(formatMs(2500)).toBe('2.50 s')
  })

  it('prints a missing measurement as an em dash, never as zero', () => {
    expect(formatMs(null)).toBe('—')
    expect(formatMs(undefined)).toBe('—')
    expect(formatMs(Number.NaN)).toBe('—')
  })

  it('prints bundle sizes in binary units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

describe('renderMarkdown', () => {
  const meta = {
    generatedAt: '2026-09-24T00:00:00.000Z',
    base: 'http://localhost:3000',
    event: 'SAMPLE2026',
    runs: 5,
    profiles: ['4g', 'venue-wifi'],
  }

  it('writes a header that names the base, the event, the runs and the budgets', () => {
    const md = renderMarkdown({ rows: [], meta })
    expect(md).toContain('# Latency — the measurement')
    expect(md).toContain('http://localhost:3000')
    expect(md).toContain('SAMPLE2026')
    expect(md).toContain('≤120 ms')
    expect(md).toContain('≤2500 ms on 4g')
    expect(md).toContain(`${VIEWPORT.width}×${VIEWPORT.height}`)
    expect(md).toContain(`${CPU_THROTTLE_RATE}×`)
    expect(md).toContain('GENERATED')
  })

  it('gives a failing row its number and a passing one its verdict', () => {
    const rows = gradeRun([
      {
        label: 'Rooms',
        profile: '4g',
        metrics: {
          tapToFirstChange: summarize([50]),
          tapToContent: summarize([400]),
          coldFirstLoad: summarize([1000]),
        },
      },
    ])
    const md = renderMarkdown({ rows, meta })
    expect(md).toContain('**FAIL**')
    expect(md).toContain('p50 400 ms against 120 ms')
    expect(md).toContain('1 gated budget(s) missed')
  })

  it('prints an em dash and the reason for a metric that was not measured', () => {
    const rows = gradeRun([
      {
        label: 'Hampers',
        profile: '4g',
        metrics: { tapToFirstChange: summarize([50]) },
        reasons: { saveToShownDone: 'no reversible write exists here' },
      },
    ])
    const md = renderMarkdown({ rows, meta })
    expect(md).toContain('not measured')
    expect(md).toContain('no reversible write exists here')
    expect(md).not.toContain('| 0 ms |')
  })

  it('says so plainly when everything is inside budget', () => {
    const rows = gradeRun([
      {
        label: 'Today',
        profile: '4g',
        metrics: { tapToFirstChange: summarize([10]) },
      },
    ])
    expect(renderMarkdown({ rows, meta })).toContain('Every gated budget is inside its limit.')
  })

  it('refuses to call a run with no numbers a pass', () => {
    // A table of `not measured` rows has zero failures, so the naive check —
    // "are there any failures?" — answers "all good" about a run that produced
    // nothing. That is the failure mode this document exists to prevent.
    const rows = gradeRun([
      {
        label: 'Today',
        profile: '4g',
        metrics: {},
        reasons: { tapToFirstChange: 'no browser' },
      },
    ])
    const md = renderMarkdown({ rows, meta })
    expect(md).toContain('**Nothing was measured.**')
    expect(md).not.toContain('Every gated budget is inside its limit.')
  })
})

describe('bundle-size helpers', () => {
  const entries = [
    { path: 'static/chunks/a.js', raw: 300, gzip: 100 },
    { path: 'static/chunks/b.js', raw: 100, gzip: 40 },
    { path: 'static/chunks/c.js', raw: 200, gzip: 80 },
  ]

  it('sums raw and gzip across every chunk', () => {
    expect(summarizeChunks(entries)).toEqual({ count: 3, raw: 600, gzip: 220 })
  })

  it('answers zero for an empty build rather than NaN', () => {
    expect(summarizeChunks([])).toEqual({ count: 0, raw: 0, gzip: 0 })
  })

  it('lists the largest chunks first, and is stable on a tie', () => {
    expect(topChunks(entries, 2).map((e) => e.path)).toEqual([
      'static/chunks/a.js',
      'static/chunks/c.js',
    ])
    const tied = [
      { path: 'z.js', raw: 10, gzip: 1 },
      { path: 'a.js', raw: 10, gzip: 1 },
    ]
    expect(topChunks(tied, 2).map((e) => e.path)).toEqual(['a.js', 'z.js'])
  })

  it('does not mutate the list it was given', () => {
    const before = entries.map((e) => e.path)
    topChunks(entries, 1)
    expect(entries.map((e) => e.path)).toEqual(before)
  })
})
