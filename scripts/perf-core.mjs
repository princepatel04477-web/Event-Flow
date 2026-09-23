/**
 * PERF-MEASURE — the pure half of `scripts/latency.mjs`.
 *
 * WHY THIS FILE IS SEPARATE FROM THE RUNNER. `scripts/latency.mjs` needs a
 * browser, and a browser is not available in every environment this job runs in
 * (the sandbox here blocks `spawn`, so `chromium.launch()` fails with EPERM).
 * A measurement harness whose arithmetic cannot be tested is a harness whose
 * numbers cannot be trusted, so everything that turns raw milliseconds into a
 * verdict lives here: percentiles, the budget table, the pass/fail grading, the
 * markdown renderer, the argument parser and the screen catalogue. All of it is
 * pure, and `tests/perf-core.test.ts` exercises all of it.
 *
 * The definitions of the metrics the budgets apply to are in `docs/LATENCY.md`,
 * because a budget without a stated definition is a number nobody can argue
 * with.
 */

/**
 * @typedef {object} Summary
 * @property {number} n         samples that were real numbers
 * @property {number|null} p50  nearest-rank median, or null when there are none
 * @property {number|null} p95  nearest-rank 95th
 * @property {number|null} min
 * @property {number|null} max
 */

/**
 * @typedef {{kind: 'tab', label: string} | {kind: 'link', endsWith: string} | {kind: 'search'}} Tap
 */

/**
 * @typedef {object} Screen
 * @property {string} label
 * @property {string} path
 * @property {string[]} donors
 * @property {Tap} tap
 * @property {{kind: string}|null} save
 * @property {string|null} saveReason
 */

/**
 * @typedef {object} ScreenResult
 * @property {string} label
 * @property {string} [path]
 * @property {string} profile
 * @property {Record<string, Summary>} metrics
 * @property {Record<string, string>} [reasons]
 */

/**
 * @typedef {object} GradeRow
 * @property {string} metric
 * @property {number} budget
 * @property {'gate'|'warn'} severity
 * @property {'pass'|'fail'|'warn'|'not-measured'} verdict
 * @property {boolean} over
 * @property {number|null} p50
 * @property {number|null} p95
 * @property {number} n
 * @property {string} [screen]
 * @property {string} [profile]
 * @property {string|null} [reason]
 */

/**
 * @typedef {object} RunOptions
 * @property {string} base
 * @property {number} runs
 * @property {string} profile
 * @property {string} out
 * @property {string} md
 * @property {string[]|null} screens
 * @property {boolean} seed
 * @property {boolean} help
 */

/**
 * @typedef {object} ChunkEntry
 * @property {string} path
 * @property {number} raw
 * @property {number} gzip
 */

/**
 * The gate, verbatim from `.brain/SPEC-PERF.md` §Measurement.
 *
 * `coldFirstLoad` is marked informational in the spec ("cold first load ≤2500 ms
 * on 4g (informational)"). It is still reported per profile, and it is still
 * graded, but a miss is a `warn` rather than a failure — see `grade()`.
 */
export const BUDGETS = {
  tapToFirstChange: 120,
  tapToContent: 120,
  saveToShownDone: 120,
  coldFirstLoad: 2500,
}

/** Which budget a miss is allowed to fail the run on. */
export const BUDGET_SEVERITY = {
  tapToFirstChange: 'gate',
  tapToContent: 'gate',
  saveToShownDone: 'gate',
  coldFirstLoad: 'warn',
}

/** The metric names, in report order. One list, used by every consumer.
 * @type {string[]} */
export const METRICS = ['coldFirstLoad', 'tapToFirstChange', 'tapToContent', 'saveToShownDone']

/** Human labels for the report. Kept here so the table and the JSON agree. */
export const METRIC_LABELS = {
  coldFirstLoad: 'Cold first load',
  tapToFirstChange: 'Tap → first visual change',
  tapToContent: 'Tap → content (warm)',
  saveToShownDone: 'Save → shown done',
}

/** Network profiles, verbatim from SPEC-PERF: 150 ms/4 Mbps and 300 ms/1.5 Mbps. */
export const PROFILES = [
  { name: '4g', latencyMs: 150, downMbps: 4, upMbps: 2 },
  { name: 'venue-wifi', latencyMs: 300, downMbps: 1.5, upMbps: 0.75 },
]

/** Chromium's mobile viewport for every measurement, from SPEC-PERF. */
export const VIEWPORT = { width: 390, height: 844 }

/** SPEC-PERF: "CPU throttle 4× via CDP". */
export const CPU_THROTTLE_RATE = 4

/**
 * Nearest-rank percentile over the raw samples.
 *
 * NEAREST-RANK AND NOT INTERPOLATED, deliberately: with five samples the
 * interpolated p95 is a number no run ever produced (its own worst sample times
 * 0.95), and a budget compared against a synthetic value hides the actual worst
 * case. Nearest-rank always returns a measurement that happened.
 *
 * `p` is 0-100. An empty list returns `null` — "no samples" is not zero.
 *
 * @param {number[]} values
 * @param {number} p
 * @returns {number|null}
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error(`percentile: p must be 0-100, got ${p}`)
  const sorted = [...values].sort((a, b) => a - b)
  // ceil(p/100 * n) - 1 is the classic nearest-rank index, clamped into range.
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1)
  return sorted[index]
}

/** p50/p95 plus the extremes, for a list of real samples. Nulls are dropped.
 * @param {Array<number|null|undefined>|null|undefined} samples
 * @returns {Summary} */
export function summarize(samples) {
  const clean = (samples ?? []).filter((n) => typeof n === 'number' && Number.isFinite(n))
  if (clean.length === 0) return { n: 0, p50: null, p95: null, min: null, max: null }
  return {
    n: clean.length,
    p50: percentile(clean, 50),
    p95: percentile(clean, 95),
    min: Math.min(...clean),
    max: Math.max(...clean),
  }
}

/**
 * Grade one metric against its budget.
 *
 * THREE OUTCOMES, NOT TWO. `null` samples are not "0 ms" and they are not
 * "over budget": they are "there is nothing to measure here" (no such control
 * on this screen, or the run could not complete). Reporting that as a pass is
 * how a broken screen gets a green line, and reporting it as a failure is how a
 * screen with no undo gets blamed for the undo it never had.
 *
 * The gate is the p50, which is what SPEC-PERF asks for ("p50/p95 over 5
 * runs"), with p95 published beside it so a median that hides a bad tail is
 * visible in the table.
 *
 * @param {string} metric
 * @param {Summary|null|undefined} summary
 * @param {number} [budget]
 * @returns {GradeRow}
 */
export function grade(metric, summary, budget = BUDGETS[metric]) {
  if (!(metric in BUDGETS)) throw new Error(`grade: unknown metric "${metric}"`)
  const severity = BUDGET_SEVERITY[metric] ?? 'gate'

  if (!summary || summary.n === 0 || summary.p50 === null) {
    return { metric, budget, severity, verdict: 'not-measured', over: false, p50: null, p95: null, n: 0 }
  }

  const over = summary.p50 > budget
  const verdict = over ? (severity === 'gate' ? 'fail' : 'warn') : 'pass'
  return { metric, budget, severity, verdict, over, p50: summary.p50, p95: summary.p95, n: summary.n }
}

/** Grade every metric of one screen, in METRICS order.
 * @param {ScreenResult} screen
 * @returns {GradeRow[]} */
export function gradeScreen(screen) {
  return METRICS.map((metric) => ({
    screen: screen.label,
    profile: screen.profile,
    ...grade(metric, screen.metrics?.[metric] ?? null),
    reason: screen.reasons?.[metric] ?? null,
  }))
}

/** Grade a whole run: a flat list of rows, one per screen × metric.
 * @param {ScreenResult[]} screens
 * @returns {GradeRow[]} */
export function gradeRun(screens) {
  return screens.flatMap(gradeScreen)
}

/** The rows that should stop a release: gate misses only.
 * @param {GradeRow[]} rows
 * @returns {GradeRow[]} */
export function failures(rows) {
  return rows.filter((r) => r.verdict === 'fail')
}

/** The rows that are worth a sentence but not a red board.
 * @param {GradeRow[]} rows
 * @returns {GradeRow[]} */
export function warnings(rows) {
  return rows.filter((r) => r.verdict === 'warn')
}

/** `1234` → `1.23 s`; under a second stays in ms. For the columns a human reads.
 * @param {number|null|undefined} ms
 * @returns {string} */
export function formatMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  return `${Math.round(ms)} ms`
}

/** `1536` → `1.5 KB`. Bundle sizes only; binary units, as the build reports them.
 * @param {number} bytes
 * @returns {string} */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/**
 * The job screens this harness measures, and the ONE tap that opens each.
 *
 * `path` is the screen. `donors` are the screens a finger could start from, in
 * the order they are tried — more than one because the v3 bar is five SECTION
 * tabs for an event lead, so a child screen like Check-in is reached from inside
 * Rooms rather than from the bar, and which screen offers that link is a fact
 * about the app rather than a fact about this harness. `tap` says how to find the
 * control:
 *
 *   { kind: 'tab', label }        a bottom-bar tab, matched by its visible label
 *   { kind: 'link', endsWith }    any `a[href]` whose href ends with this
 *   { kind: 'search' }            the header's Search action
 *
 * `save` names the one safe, reversible commit on that screen, if there is one.
 * Every write here is a deferred write the app itself offers an Undo for, and
 * the harness presses that Undo as soon as the number is taken. Screens with no
 * such action say so in `saveReason` rather than being silently skipped — the
 * RSVP outcome freezes a `call_attempts` row permanently and a hamper proof is
 * insert-only, so neither may be used to time a "save".
 *
 * WHY `/{event}/hospitality/deliveries` AND NOT `/{event}/hamper`: the Hampers
 * tab points at `/{event}/hamper`, which `src/lib/departments.ts` records as a
 * stale re-export of the v1 screen under the v2 route group. The real v2 job
 * screen is the deliveries board.
 *
 * @param {string} eventCode
 * @returns {Screen[]}
 */
export function screenCatalog(eventCode) {
  const c = eventCode
  return [
    {
      label: 'Today',
      path: `/${c}`,
      donors: [`/${c}/find`, `/${c}/rsvp/queue`],
      tap: { kind: 'tab', label: 'Today' },
      save: null,
      saveReason: 'Today is a read-only dashboard: it has no write to time.',
    },
    {
      label: 'Calls',
      path: `/${c}/rsvp/queue`,
      donors: [`/${c}`, `/${c}/find`],
      tap: { kind: 'link', endsWith: '/rsvp/queue' },
      save: null,
      // `app.guard_call_attempt()` freezes the row the moment `outcome` is set,
      // and DELETE is blocked by trigger for every role including service.
      saveReason:
        'No reversible write: logging a call outcome freezes its call_attempts row permanently (CLAUDE.md §5.4), so timing a "save" here would write data the TEST event cannot take back.',
    },
    {
      label: 'Rooms',
      path: `/${c}/hospitality/rooms`,
      donors: [`/${c}`, `/${c}/find`],
      tap: { kind: 'link', endsWith: '/hospitality/rooms' },
      save: { kind: 'room-give' },
      saveReason: null,
    },
    {
      label: 'Check-in',
      path: `/${c}/hospitality/checkin`,
      donors: [`/${c}/hospitality/rooms`, `/${c}`],
      tap: { kind: 'link', endsWith: '/hospitality/checkin' },
      save: null,
      saveReason:
        'No reversible write on this screen: check-in writes are not offered an Undo, and the harness must not leave a real arrival recorded on the TEST event.',
    },
    {
      label: 'Hampers',
      path: `/${c}/hospitality/deliveries`,
      donors: [`/${c}/hospitality/rooms`, `/${c}`, `/${c}/hamper`],
      tap: { kind: 'link', endsWith: '/hospitality/deliveries' },
      save: null,
      // `delivery_proofs` is insert-only with unconditional block_mutation
      // triggers — not even the service role can delete one (CLAUDE.md §5.2).
      saveReason:
        'No reversible write: a hamper proof is insert-only and cannot be deleted by any role, so there is nothing to undo after timing it.',
    },
    {
      label: 'Arrivals',
      path: `/${c}/logistics/arrivals`,
      donors: [`/${c}`, `/${c}/find`],
      tap: { kind: 'link', endsWith: '/logistics/arrivals' },
      save: { kind: 'mark-arrived' },
      saveReason: null,
    },
    {
      label: 'Guests search',
      path: `/${c}/find`,
      donors: [`/${c}`, `/${c}/hospitality/rooms`],
      tap: { kind: 'search' },
      save: null,
      saveReason: 'Search is a read: typing produces results, and no write happens on this screen.',
    },
  ]
}

/** Only the screens whose labels were asked for. Unknown labels throw.
 * @param {Screen[]} catalog
 * @param {string[]|null} [labels]
 * @returns {Screen[]} */
export function selectScreens(catalog, labels) {
  if (!labels || labels.length === 0) return catalog
  const wanted = new Set(labels)
  const unknown = [...wanted].filter((l) => !catalog.some((s) => s.label === l))
  if (unknown.length > 0) {
    throw new Error(
      `unknown screen(s): ${unknown.join(', ')}. Known screens: ${catalog.map((s) => s.label).join(', ')}`,
    )
  }
  return catalog.filter((s) => wanted.has(s.label))
}

/**
 * The command line, parsed and validated.
 *
 * `BASE` is the only environment input SPEC-PERF names, and it defaults to
 * `http://localhost:3000`. `--base` exists so a production build on another port
 * can be measured without exporting anything.
 *
 * @param {string[]} [argv]
 * @param {Record<string, string|undefined>} [env]
 * @returns {RunOptions}
 */
export function parseArgs(argv = [], env = {}) {
  const opts = {
    base: env.BASE || 'http://localhost:3000',
    runs: 5,
    profile: 'both',
    out: 'e2e/latency-results.json',
    md: 'docs/LATENCY.md',
    screens: null,
    seed: true,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`${arg} needs a value`)
      i += 1
      return v
    }

    switch (arg) {
      case '--base':
        opts.base = value().replace(/\/+$/, '')
        break
      case '--runs':
        opts.runs = Number(value())
        break
      case '--profile':
        opts.profile = value()
        break
      case '--out':
        opts.out = value()
        break
      case '--md':
        opts.md = value()
        break
      case '--screens':
        opts.screens = value()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case '--no-seed':
        opts.seed = false
        break
      case '--help':
      case '-h':
        opts.help = true
        break
      default:
        throw new Error(`unknown argument "${arg}" (try --help)`)
    }
  }

  if (!Number.isInteger(opts.runs) || opts.runs < 1 || opts.runs > 50) {
    throw new Error(`--runs must be an integer 1-50, got ${opts.runs}`)
  }
  if (!['4g', 'venue-wifi', 'both'].includes(opts.profile)) {
    throw new Error(`--profile must be 4g, venue-wifi or both, got "${opts.profile}"`)
  }
  if (!opts.base.startsWith('http')) {
    throw new Error(`--base must be an http(s) URL, got "${opts.base}"`)
  }

  return opts
}

/** The profiles a run will use, in the spec's order.
 * @param {string} profile
 * @returns {Array<{name: string, latencyMs: number, downMbps: number, upMbps: number}>} */
export function profilesFor(profile) {
  if (profile === 'both') return PROFILES
  const found = PROFILES.find((p) => p.name === profile)
  if (!found) throw new Error(`no such profile: ${profile}`)
  return [found]
}

/**
 * The markdown table, and the header a reader needs to interpret it.
 *
 * A row with no measurement prints `—` and the REASON, never `0` and never a
 * silent blank: on a screen with no undo, the interesting fact is that the
 * metric does not exist, and a blank would read as a pass.
 *
 * @param {{rows: GradeRow[], meta: {generatedAt: string, base: string, event?: string|null, runs: number, profiles: string[]}}} input
 * @returns {string}
 */
export function renderMarkdown({ rows, meta }) {
  const lines = []
  lines.push('# Latency — the measurement')
  lines.push('')
  lines.push(
    '<!-- GENERATED by `npm run latency` (scripts/latency.mjs). Do not hand-edit: ' +
      'the next run overwrites it. -->',
  )
  lines.push('')
  lines.push(
    'Budgets are `.brain/SPEC-PERF.md` §Measurement: tap → first visual change **≤120 ms**, ' +
      'tap → content on a warm store **≤120 ms**, save → shown done **≤120 ms**, cold first load ' +
      '**≤2500 ms on 4g** (informational). The gate is the **p50**; p95 is published beside it.',
  )
  lines.push('')
  lines.push('| | |')
  lines.push('|---|---|')
  lines.push(`| Measured | ${meta.generatedAt} |`)
  lines.push(`| Base URL | \`${meta.base}\` |`)
  lines.push(`| Event | \`${meta.event ?? '—'}\` |`)
  lines.push(`| Runs per metric | ${meta.runs} |`)
  lines.push(`| Profiles | ${meta.profiles.join(', ')} |`)
  lines.push(`| Viewport / CPU | ${VIEWPORT.width}×${VIEWPORT.height}, ${CPU_THROTTLE_RATE}× CPU throttle |`)
  lines.push('')
  lines.push('## Results')
  lines.push('')
  lines.push('| Screen | Profile | Metric | p50 | p95 | Budget | n | Verdict |')
  lines.push('|---|---|---|---:|---:|---:|---:|---|')

  for (const row of rows) {
    const verdict =
      row.verdict === 'fail'
        ? '**FAIL**'
        : row.verdict === 'warn'
          ? 'over (informational)'
          : row.verdict === 'pass'
            ? 'pass'
            : 'not measured'
    const note = row.verdict === 'not-measured' && row.reason ? ` — ${row.reason}` : ''
    lines.push(
      `| ${row.screen} | ${row.profile} | ${METRIC_LABELS[row.metric] ?? row.metric} | ` +
        `${formatMs(row.p50)} | ${formatMs(row.p95)} | ${formatMs(row.budget)} | ${row.n} | ${verdict}${note} |`,
    )
  }

  const failed = rows.filter((r) => r.verdict === 'fail')
  const warned = rows.filter((r) => r.verdict === 'warn')
  const measured = rows.filter((r) => r.verdict !== 'not-measured')

  lines.push('')
  lines.push('## Verdict')
  lines.push('')
  if (measured.length === 0) {
    // The one outcome that must never read as a pass. A table of `not measured`
    // rows has zero failures, and "everything is inside budget" would be a lie
    // about a run that produced no numbers at all.
    lines.push(
      '**Nothing was measured.** Every row above is `not measured`, for the reason in its ' +
        'last column. This file proves the harness ran; it says nothing about how fast the app is.',
    )
  } else if (failed.length === 0) {
    lines.push(
      warned.length === 0
        ? 'Every gated budget is inside its limit.'
        : `Every gated budget is inside its limit. ${warned.length} informational budget(s) are over.`,
    )
  } else {
    lines.push(`${failed.length} gated budget(s) missed:`)
    lines.push('')
    for (const row of failed) {
      lines.push(
        `- **${row.screen}** (${row.profile}) ${METRIC_LABELS[row.metric] ?? row.metric}: ` +
          `p50 ${formatMs(row.p50)} against ${formatMs(row.budget)}`,
      )
    }
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

/**
 * Client-JS accounting for `scripts/bundle-size.mjs`.
 *
 * Takes `{ path, raw, gzip }` rows and answers the two questions the bundle work
 * needs: how big is the whole client bundle, and which single chunks dominate
 * it. `attributed` maps a chunk's path to the routes whose manifests reference
 * it, so a big chunk can be blamed on a screen instead of on "the app".
 *
 * @param {ChunkEntry[]} entries
 * @returns {{count: number, raw: number, gzip: number}}
 */
export function summarizeChunks(entries) {
  const raw = entries.reduce((sum, e) => sum + e.raw, 0)
  const gzip = entries.reduce((sum, e) => sum + e.gzip, 0)
  return { count: entries.length, raw, gzip }
}

/** The `n` largest chunks, largest first. Ties broken by path, so output is stable.
 * @param {ChunkEntry[]} entries
 * @param {number} [n]
 * @returns {ChunkEntry[]} */
export function topChunks(entries, n = 15) {
  return [...entries]
    .sort((a, b) => b.raw - a.raw || a.path.localeCompare(b.path))
    .slice(0, n)
}
