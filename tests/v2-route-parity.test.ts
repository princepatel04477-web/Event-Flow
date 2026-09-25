import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { tabHrefFor } from '@/app/(app)/v2/[eventCode]/_components/AppTabs'
import { bottomTabsFor } from '@/lib/sections/config'

/**
 * Filesystem parity between the legacy group and the new one.
 *
 * WHY THIS FILE EXISTS, and why nothing else in the repo can do this job.
 *
 * The new UI lives in a second route tree (`(app)/v2/[eventCode]`) and the
 * proxy rewrites an event-scoped URL onto it when `NEXT_PUBLIC_UI=v2`. There is
 * NO rewrite fallback: a path that exists in `(staff)` but not under `v2` is a
 * 404, not the legacy screen — verified on a production build with a real
 * session (AMENDMENTS §3). On venue Wi-Fi, for a runner holding a phone, a dead
 * destination is indistinguishable from a broken app, and the tab bar is the
 * only navigation most of these users have.
 *
 * That class of bug is invisible to every other gate we run:
 *
 *   - `tsc` types the *contents* of a route file, never the existence of a route.
 *   - eslint sees a `href` as a string literal and nothing more.
 *   - component tests render the bar; they do not ask whether the destination is
 *     on disk. `tests/nav-model.test.ts` asserts the href MODEL — deliberately,
 *     and it pins the legacy defaults — not route existence.
 *   - the build only catches the inverse (two pages resolving to one path).
 *
 * So the check has to be the filesystem, and it has to run before the parent's
 * `next build`. Three things are asserted:
 *
 *   1. Every legacy `page.tsx`/`layout.tsx` has a v2 counterpart, unless it is a
 *      screen V7 rebuilt by hand or a documented deliberate exception. A legacy
 *      screen added later without a shim is a 404 waiting for a user.
 *   2. Every v2 `page.tsx` that is NOT a shim maps to a path that really exists
 *      in the legacy tree, and every shim's re-export target is a real file. A
 *      typo in a module specifier is a 404 that typecheck would have caught,
 *      but a typo in a *path segment* is not.
 *   3. The one tab remap is right and, just as importantly, is the ONLY one.
 *
 * `environment: 'node'` is the vitest default here, so this costs a directory
 * walk and no DOM.
 */

const ROOT = path.resolve(__dirname, '..')
const LEGACY_ROOT = path.join(ROOT, 'src', 'app', '(staff)', '[eventCode]')
const V2_ROOT = path.join(ROOT, 'src', 'app', '(app)', 'v2', '[eventCode]')

/**
 * Paths V7 rebuilt by hand at the SAME v2-relative path, so there is no shim to
 * find and their absence from the shim set is correct rather than an oversight.
 * Keyed by `page`/`layout` so a real page cannot silence a missing layout.
 */
const REPLACED_BY_V7 = {
  page: new Set([
    'rsvp/queue', // Job 1 — call the next family
    'hospitality/rooms', // Job 2 — give a family a room
    'hospitality/deliveries', // Job 3 — hamper run
    'hospitality/deliveries/[deliverableId]', // proof capture
    'logistics/arrivals', // Job 4 — meet arrivals
  ]),
  layout: new Set([
    // V6 built the new shell: it owns the guards the legacy event layout owns.
    '',
  ]),
} as const

/**
 * v2 routes that are GENUINELY NEW — no legacy screen at the same path, because
 * no legacy screen does this job at all.
 *
 * A THIRD list rather than an entry in `REPLACED_BY_V7.page`, and the two are
 * not interchangeable. `REPLACED_BY_V7.page` answers "is this route a HAND-BUILT
 * replacement for a legacy screen?"; this one answers "is this route NEW?".
 * V7's five are both — they took over the legacy paths. `find` is only the
 * second: there is no `(staff)/[eventCode]/find` and never was, so the parity
 * checks that look for a legacy counterpart have nothing to find and would
 * report a working route as an orphan.
 *
 * Adding a name here does NOT silence the missing-page assertion above; a route
 * has to be on disk for that one, and this list is only consulted by the two
 * checks that compare a v2 route against the legacy tree. So this stays a real
 * allowlist rather than a place to park a typo.
 */
const NEW_IN_V8 = new Set([
  'find', // one box that finds anyone — no legacy screen does this
])

/**
 * The same list, for the next session that added a screen rather than converted
 * one. Kept as its own set rather than grown into `NEW_IN_V8`: the sets answer
 * "is this route new?" identically, but the NAME is what tells a reader which
 * session owed the route and, therefore, which session's brief to re-read
 * before deleting it. A single set named after one session would quietly
 * misattribute every later addition.
 *
 * `help` is the V11 cheat sheet opened by the "?" control in the new header:
 * one screen listing what each of this viewer's tabs is for, plus who to ask
 * when something is wrong. Nothing like it exists in the legacy tree — v1's
 * equivalent is training, and this app's users get none (that is the brief).
 */
const NEW_IN_V11 = new Set([
  'help', // the "?" cheat sheet — a screen v1 has no counterpart for
])

/**
 * T6's rooming list is the third kind of new route, and the reason this is a
 * set of its own rather than another name in `NEW_IN_V11`: the rooming list is
 * a printable Hospitality table (hotel, room, type, family, pax, check-in,
 * hamper) that no v1 screen ever rendered. v1 had the room board and the room
 * sheet, not a per-guest list you hand to a hotel desk, so there is no legacy
 * path for the parity check to find.
 */
const NEW_IN_T6 = new Set([
  'hospitality/rooming-list', // printable rooming list — v1 never had one
])

/** Every route any session added that has no legacy counterpart at all. */
const NEW_ROUTES = new Set([...NEW_IN_V8, ...NEW_IN_V11, ...NEW_IN_T6])

/**
 * FIX-UI took the hospitality layout exception away.
 *
 * It used to be the one legacy section layout with no v2 counterpart, because a
 * strict `requireSection(..., 'hospitality')` shim would lock the hamper team out
 * of `hospitality/deliveries` — their copy of the hamper run. The fix is the one
 * this file's comment recommended: a REAL v2 layout whose guard is the UNION of
 * the hospitality and hamper departments (`requireAnySection`). That keeps the
 * hamper team in, keeps travel/production/client out, and restores the
 * section-level gate the three re-exported screens (`checkin`, `rooms/new`,
 * `rooms/allocate`) had lost — `docs/BUGS.md` M2 and M7.
 */

/**
 * A shim re-exports a legacy PAGE or LAYOUT — nothing else.
 *
 * Three traps this is written around, each of which produced a false result
 * while this file was being written:
 *
 *   - A bare `@/app/(staff)/[eventCode]/` marker also matches a hand-written v2
 *     screen that legitimately IMPORTS a legacy component (V7's
 *     `deliveries/[deliverableId]/page.tsx` imports the legacy `DeliveryDetail`).
 *     Anchored to a `/page` or `/layout` tail so only a route re-export matches.
 *   - The extension is NOT part of the capture. A lazy `[^'"]+?` followed by an
 *     optional `.tsx`/`.ts` group lets the lazy quantifier swallow the extension
 *     instead of leaving it to the optional group, which silently produced a
 *     `.../page.tsx.tsx` lookup. The specifier is normalised in code instead.
 *   - The shim's own comment header contains the words "export * from", so it
 *     has to be stripped before matching or every shim false-positives on its
 *     own prose.
 */
const SHIM_REEXPORT_RE = /(?:import|export)[^'"]*from\s+'(@\/app\/\(staff\)\/\[eventCode\]\/[^'"]+)'/g

/**
 * The legacy path a specifier points at, extension stripped.
 *
 * `allowImportingTsExtensions` is off in this repo's tsconfig, so a shim MUST
 * write `.../guests/list/page` and never `/page.tsx` — the extensioned form is a
 * TS5097 typecheck error, which is exactly how that was discovered. Both forms
 * are accepted here anyway so the assertion does not depend on the habit.
 */
function normalizeSpec(spec: string): string {
  return spec.replace(/\.tsx?$/, '')
}

/** Does an extensionless module specifier resolve to a file on disk? */
function moduleExists(fromDir: string, rel: string): boolean {
  const base = path.join(fromDir, normalizeSpec(rel).split('/').join(path.sep))
  return ['', '.tsx', '.ts', '.js'].some((ext) => fs.existsSync(base + ext))
}

/** Strip line and block comments — enough for these few-line modules. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir: string, name: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, name))
    else if (entry.isFile() && entry.name === name) out.push(full)
  }
  return out
}

/** The route path of a page/layout file, relative to its group root, without `/page.tsx`. */
function routeOf(file: string, groupRoot: string): string {
  const dir = path.dirname(path.relative(groupRoot, file))
  return dir === '.' ? '' : dir.split(path.sep).join('/')
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8')
}

function isShim(file: string): boolean {
  SHIM_REEXPORT_RE.lastIndex = 0
  return SHIM_REEXPORT_RE.test(stripComments(read(file)))
}

function legacyPages(): string[] {
  return walk(LEGACY_ROOT, 'page.tsx').map((f) => routeOf(f, LEGACY_ROOT)).sort()
}

function v2PageRoutes(): string[] {
  return walk(V2_ROOT, 'page.tsx').map((f) => routeOf(f, V2_ROOT)).sort()
}

function v2LayoutRoutes(): string[] {
  return walk(V2_ROOT, 'layout.tsx').map((f) => routeOf(f, V2_ROOT)).sort()
}

describe('every legacy screen is reachable under the new shell', () => {
  it('has a v2 page for every legacy page, or a documented reason', () => {
    const present = new Set(v2PageRoutes())

    const missing = legacyPages().filter(
      (route) => !present.has(route) && !REPLACED_BY_V7.page.has(route),
    )

    expect(
      missing,
      `These legacy pages have no v2 page and no shim, so under NEXT_PUBLIC_UI=v2 ` +
        `they are 404s with no fallback. Add ` +
        `src/app/(app)/v2/[eventCode]/<route>/page.tsx as a re-export, or add it to ` +
        `REPLACED_BY_V7.page if V7+ built the real screen:\n` +
        missing.map((r) => `  /{event}/${r}`).join('\n'),
    ).toEqual([])
  })

  it('has a v2 layout for every legacy section layout, or a documented exception', () => {
    const legacyLayouts = walk(LEGACY_ROOT, 'layout.tsx').map((f) => routeOf(f, LEGACY_ROOT))
    const present = new Set(v2LayoutRoutes())

    const missing = legacyLayouts
      .filter((route) => !present.has(route) && !REPLACED_BY_V7.layout.has(route))

    expect(
      missing,
      `A section layout is where requireSection lives in v1. The new group is a ` +
        `different tree, so without the shim those v2 screens lose that guard. ` +
        `Re-export it rather than reimplement it, so the guard cannot drift:\n` +
        missing.map((r) => `  /{event}/${r}`).join('\n'),
    ).toEqual([])
  })

  it('keeps the hospitality union guard in place, and hand-written', () => {
    // The v2 hospitality layout is the ONE section layout that is not a shim,
    // because its audience is the union of two departments (the hamper run at
    // `hospitality/deliveries`). Replacing it with a re-export of the legacy
    // layout would reinstate the strict hospitality gate and bounce the hamper
    // team off their own screen — the reason it was omitted in the first place.
    expect(v2LayoutRoutes()).toContain('hospitality')
    const layout = path.join(V2_ROOT, 'hospitality', 'layout.tsx')
    expect(fs.existsSync(layout)).toBe(true)
    expect(isShim(layout), 'the hospitality layout must not be a legacy re-export').toBe(false)
    expect(read(layout)).toContain('requireAnySection')
  })
})

describe('every v2 route is real', () => {
  it('re-exports a legacy file that exists, for every shim', () => {
    const targets: { file: string; spec: string }[] = []

    for (const file of [
      ...walk(V2_ROOT, 'page.tsx'),
      ...walk(V2_ROOT, 'layout.tsx'),
      ...walk(V2_ROOT, 'loading.tsx'),
      ...walk(V2_ROOT, 'not-found.tsx'),
    ]) {
      if (!isShim(file)) continue
      // The specifier is how the parity test finds the target, so it is read
      // rather than reconstructed: a mismatch here is the bug being hunted.
      SHIM_REEXPORT_RE.lastIndex = 0
      const match = SHIM_REEXPORT_RE.exec(stripComments(read(file)))
      targets.push({ file: path.relative(ROOT, file), spec: match?.[1] ?? '' })
    }

    expect(targets.length, 'expected the shim sweep to exist').toBeGreaterThan(0)

    const unresolved = targets.filter(({ spec }) => {
      if (!spec) return true
      // Dynamic segments are directory names one-for-one: `[eventCode]` here,
      // `[groupId]`/`[deliverableId]` there. A mismatch in either is the whole
      // point of this assertion.
      return !moduleExists(LEGACY_ROOT, spec.replace('@/app/(staff)/[eventCode]/', ''))
    })

    expect(
      unresolved,
      `These shims re-export a module that is not on disk. The path is one segment ` +
        `off, which is a 404 at runtime and green everywhere else:\n` +
        unresolved.map((t) => `  ${t.file} -> ${t.spec || '(no specifier found)'}`).join('\n'),
    ).toEqual([])
  })

  it('maps every non-shim v2 page onto a legacy path that exists', () => {
    const orphans = walk(V2_ROOT, 'page.tsx')
      .filter((file) => !isShim(file))
      .map((file) => routeOf(file, V2_ROOT))
      // V6's new home is a v2-native screen: there is no legacy page at the
      // event root to mirror (the legacy root page is the v1 dashboard).
      .filter((route) => route !== '')
      // V8's `find` and V11's `help` are the other kind of new route — a job no
      // legacy screen does, so there is no path for them to map onto. Named in
      // `NEW_IN_V8` / `NEW_IN_V11` rather than excused inline, so the set of
      // genuinely-new screens is one list a reader can see whole.
      .filter((route) => !NEW_ROUTES.has(route))
      .filter((route) => !fs.existsSync(path.join(LEGACY_ROOT, route.split('/').join(path.sep), 'page.tsx')))

    expect(
      orphans,
      `A hand-written v2 page with no legacy counterpart is usually a typo in a ` +
        `path segment — the route builds, then 404s in the field:\n` +
        orphans.map((r) => `  /{event}/${r}`).join('\n'),
    ).toEqual([])
  })

  it('keeps the genuinely-new allowlist honest', () => {
    // An entry here silences the orphan check above, so a stale one would be a
    // licence to add a path that has no page. Assert every name — in EVERY
    // session's set, which is why this iterates the union rather than one set —
    // is a real route. A set that stops naming a route fails here instead of
    // rotting into a comment.
    const present = new Set(v2PageRoutes())
    for (const route of NEW_ROUTES) {
      expect(present, `${route} is on a new-route allowlist but no page.tsx exists`).toContain(route)
    }
  })
})

describe('the new bar points at the new call screen', () => {
  const EV = 'SHARMA26'

  it('sends the Calls tab to rsvp/queue instead of its legacy default', () => {
    expect(tabHrefFor(`/${EV}/rsvp/campaigns`)).toBe(`/${EV}/rsvp/queue`)
  })

  it('leaves the other four default children exactly where the config put them', () => {
    const defaults = bottomTabsFor(EV, 'admin', 'management').map((t) => t.href)

    // Guards the SET as well as the mapping: if the shared config ever grows a
    // sixth tab, or a default child moves, this fails here rather than on a
    // phone. The set must stay the five sections.
    expect(defaults).toEqual([
      `/${EV}`,
      `/${EV}/guests/list`,
      `/${EV}/rsvp/campaigns`,
      `/${EV}/logistics/arrivals`,
      `/${EV}/hospitality/rooms`,
    ])

    const mapped = defaults.map(tabHrefFor)
    expect(mapped).toEqual([
      `/${EV}`,
      `/${EV}/guests/list`,
      `/${EV}/rsvp/queue`,
      `/${EV}/logistics/arrivals`,
      `/${EV}/hospitality/rooms`,
    ])

    // Exactly one changed. A second silent remap is the failure this pins.
    const changed = defaults.filter((href, i) => href !== mapped[i])
    expect(changed).toEqual([`/${EV}/rsvp/campaigns`])
  })

  it('leaves a runner\'s child tabs alone', () => {
    // A runner's tabs are their own section's children, and the mapping must not
    // touch them — the hospitality tab "Check in / out" is not a default child.
    for (const href of bottomTabsFor(EV, 'event_team', 'hospitality').map((t) => t.href)) {
      expect(tabHrefFor(href)).toBe(href)
    }
    for (const href of bottomTabsFor(EV, 'event_team', 'logistics').map((t) => t.href)) {
      expect(tabHrefFor(href)).toBe(href)
    }
  })

  it('does not remap a path that merely mentions campaigns', () => {
    // The remap is anchored to the END of the href. A screen whose name starts
    // with `campaigns` (or a campaign record deep-link) must pass through.
    expect(tabHrefFor(`/${EV}/rsvp/campaigns/abc-123`)).toBe(`/${EV}/rsvp/campaigns/abc-123`)
    expect(tabHrefFor(`/${EV}/rsvp/campaigns-archive`)).toBe(`/${EV}/rsvp/campaigns-archive`)
  })
})
