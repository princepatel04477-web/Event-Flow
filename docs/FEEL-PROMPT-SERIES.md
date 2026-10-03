# EventFlow — "Feels like CRED" Prompt Series (speed first, then motion + dark mode)

For **Command Code** (DeepSeek V4 Flash) or Claude Code, against `C:\dev\EventFlow`, on the
production branch `brain/showcase` (work in a worktree, e.g. `brain/feel-oct`).

**Run ONE prompt per session, in order. Commit between each.** A Flash-class model drifts when
the scope is wide; every prompt below is narrow enough to finish and verify in one go.

---

## Why the app feels slow and "made for developers" — the evidence

Your own `docs/FEEL-BASELINE.md` (21 Sep, 238 families, venue Wi-Fi profile) already measured it:

| What the runner does | Measured | Budget (INTERACTION-CONTRACT) |
|---|---|---|
| Taps a family → first thing on screen changes | **3.2 s** (worst content 30 s) | 0.1 s |
| Opens Home | **4.9 s** | — |
| Opens Rooms | **6.3 s** | 2 s |
| Opens Arrivals | **1.3 s** (the only screen on the shared query cache) | 2 s |

**The lag is architectural, not an animation problem.** Every tap is a full server round trip:
the page runs on Vercel in Seoul (`icn1`), awaits `resolveEventByCode` → `requireSection` →
`getEventAccess` one after another, fetches its data, and only then sends HTML to the phone in
India. Nothing appears until all of that returns, so the phone looks frozen and people tap
twice. Arrivals is fast because it reads a client cache — that is the pattern to copy
everywhere.

**What CRED actually does** (the parts that matter for a staff app):
1. **Every touch answers in the same frame.** Buttons press down (scale ≈ 0.97, darker
   surface) before any network call starts.
2. **The next screen appears immediately**, drawn from data already on the phone, then
   refreshes quietly. You never watch a blank screen.
3. **Motion explains what happened**: sheets rise from where you tapped, success is a short
   check-and-settle, numbers count up. Springs, not linear fades. 150–300 ms, never longer.
4. **One obvious action per screen**, big and thumb-reachable. Everything else is secondary.
5. **Dark, high-contrast surfaces with depth** (CRED's look). You chose **light default +
   dark toggle**.

Order matters: animating a screen that takes 3 s to respond makes it feel worse. **Phase A
(S0–S5) removes the lag. Phase B (M1–M6) adds the feel. P-Final proves it.**

> Mobbin could not be used: the connected Mobbin account is on the free plan and its search
> needs a paid plan. The motion and layout rules below are written out in full instead, so
> the agent does not need references.

---

## PREAMBLE — paste at the top of every prompt, replacing `[PREAMBLE]`

```
You are working on EventFlow, a wedding/event operations app used by 10-20 staff on cheap
Android phones over bad venue Wi-Fi. Repo: C:\dev\EventFlow. Read CLAUDE.md first; its rules
override anything below. Also read docs/INTERACTION-CONTRACT.md and docs/FEEL-BASELINE.md.

Stack: Next.js 16.2 App Router (src/proxy.ts), React 19, TypeScript strict, Tailwind v4 with
tokens in src/app/globals.css (--ef-*), TanStack Query v5, Dexie/idb, `motion` 13 via
LazyMotion + domAnimation (src/components/motion, src/lib/motion), Supabase with RLS.
Screens live in src/app/(app)/v2/[eventCode]/**. The APK is a remote shell over the
deployed site, so every web change ships with a deploy — no APK rebuild — unless a prompt
says otherwise.

Rules for every task:
- No `any`, no console.log, no stubs or TODOs. Every change works end to end.
- Do not rename routes, DB values, cookie/storage keys (CLAUDE.md §12: nuvent_* are FROZEN).
- Do not edit next.config.ts. Do not add dependencies unless the prompt allows one.
- DB changes: a new timestamped file in supabase/migrations/ only. Do NOT apply it to the
  live database. List it in your report.
- Animate only transform and opacity. Never animate width/height/top/left/box-shadow.
  Never use motion's `layout` prop on lists (domMax is excluded on purpose — see
  src/lib/motion/features.ts). Respect prefers-reduced-motion: durations become 0.
- Mobile first: at 360x740 and 390x844 nothing overflows, targets >= 44px, the tab bar never
  covers content.
- After the task run `npx tsc --noEmit`, `npx vitest run`, `NEXT_PUBLIC_UI=v2 npm run build`
  and `npx eslint <files you touched>` (repo-wide lint is known-red; only your files must be
  clean). All must pass.
- Commit as `feel(<id>): <what>`, one prompt per commit.
- Report: files changed, how you verified, before/after numbers where the prompt asks for
  them, and anything you could not verify on a real phone (CLAUDE.md §14: committed is not
  verified).
```

---

# PHASE A — Remove the lag

## S0 — Measure the real thing (production build, not dev)

```
[PREAMBLE]

TASK: Re-run the feel baseline against a PRODUCTION build so every later prompt has honest
before/after numbers. docs/FEEL-BASELINE.md was measured on `next dev`, which is slower and
noisier than what staff get.

1. Build and serve: NEXT_PUBLIC_UI=v2 npm run build && npm run start (port 3000).
2. Run node scripts/feel-baseline.mjs against it, both throttle profiles.
3. Add the two missing probes the doc lists as NOT MEASURED, if they can be done without a
   proxy metric:
   - M2 tap -> destination frame: add a `data-screen="<route-id>"` attribute on the root
     element of each v2 screen's main column and wait for it.
   - M5 back -> list restored: from the family record, history.back() and wait for the list
     row that was tapped to be visible.
4. Write the results as a new dated section at the top of docs/FEEL-BASELINE.md (keep the old
   section below it). Same tables as before plus M2 and M5.

Files you may change: scripts/feel-baseline.mjs, the root element of each v2 screen
(attribute only), docs/FEEL-BASELINE.md.

Done when: the new section exists with numbers for home, rsvp-queue, guest-list, rooms,
arrivals, M1, M2, M3, M5 on both profiles, measured on `npm run start`.
```

## S1 — Every touch answers in the same frame

```
[PREAMBLE]

TASK: Make every tap produce a visible response within one frame (<= 100 ms), before any
network call. Today a tap does nothing for ~3 s (FEEL-BASELINE M1), so people tap twice.

BUILD:
1. src/components/ui/Pressable.tsx: the single primitive for anything tappable (button, row,
   card, tile, link). On pointerdown: scale to 0.97 and switch to the pressed surface token
   (add --ef-press to globals.css for every theme) using CSS only — a `data-pressed`
   attribute plus a 90 ms transform transition. No JS animation library on this path; it
   must work while the main thread is busy. Release springs back in 160 ms. Supports
   `asChild`-style wrapping of next/link <Link>. Keyboard: Enter/Space trigger, focus ring
   from existing tokens. Disabled state has no press.
2. Navigation pending state: use Next 16's useLinkStatus() inside a small <PendingDot/>
   rendered in every list-row link and tab-bar item, so the tapped row shows a subtle
   in-progress mark instantly and keeps it until the next screen commits.
3. Replace ad-hoc tappables in: the bottom tab bar, Home tiles and attention list, the RSVP
   call queue rows, the guest list rows, room cards and hamper rows. Find them with
   `grep -rn "onClick\|<Link" src/app/(app)/v2 src/components` and convert the ones a
   runner taps. Do not restyle anything else.
4. Kill the 300 ms tap delay and grey flash in the WebView: globals.css gets
   `touch-action: manipulation` on interactive elements and
   `-webkit-tap-highlight-color: transparent` (Pressable replaces the highlight).

Read first: docs/INTERACTION-CONTRACT.md (T1), src/components/ui/, src/app/globals.css.

Files you may change: src/components/ui/Pressable.tsx (new), src/components/ui/PendingDot.tsx
(new), globals.css, and the listed screens' components (tappable wrappers only).

Done when: on a production build with 4x CPU throttle in Chrome devtools, every converted
element changes appearance in the same frame as pointerdown (record a Performance trace and
state the frame gap). Re-run S0's M1 and report before/after.
```

## S2 — One database round trip before a screen can render

```
[PREAMBLE]

TASK: Remove the sequential server waterfall that runs before EVERY screen. Today the layout
and page each await resolveEventByCode -> requireSection -> getEventAccess one after another
(src/lib/supabase/queries.ts, src/lib/auth/section-guard.ts), and the phone waits for all of
them before it sees anything.

BUILD:
1. Migration (do not apply): an RPC `public.route_context(p_event_code text)` returning, in
   ONE call, the event row (id, code, name, dates), the viewer's access
   ('admin'|'event_team'|'client'|'none') computed exactly as getEventAccess does today, the
   viewer's department and the section locks. SECURITY INVOKER; it must return nothing for an
   event the viewer cannot see. Case-insensitive code match (same behaviour as
   resolveEventByCode).
2. src/lib/route-context.ts: `getRouteContext(eventCode)` wrapped in React `cache()` so the
   layout and the page share ONE call per request. Keep the existing functions as thin
   wrappers over it so nothing else has to change.
3. Every v2 layout/page that awaits more than one of those helpers now awaits
   getRouteContext once. Independent data fetches in the same page run in Promise.all, never
   one after another.
4. A vitest proving getRouteContext is called once per request even when layout + page +
   requireSection all ask for it.
5. Until the migration is applied, getRouteContext must fall back to the current three calls
   (feature-detect the RPC's absence once and remember it) so this commit is safe to deploy
   before the migration.

Files you may change: one new migration, src/lib/route-context.ts (new),
src/lib/supabase/queries.ts, src/lib/auth/section-guard.ts, v2 layout.tsx/page.tsx files
(data-loading lines only), tests.

Done when: server timing (traceFetch/phaseTiming output) for Home shows one context query
instead of three sequential ones; report the before/after ms from a production build.
```

## S3 — Rooms and Home open instantly on the second visit

```
[PREAMBLE]

TASK: Convert Rooms (the slowest screen, 6.3 s) and Home (4.9 s) to the pattern Arrivals
already uses (src/app/(staff)/[eventCode]/logistics/arrivals/ArrivalsClient.tsx, served by the
v2 arrivals route — read it first): the server pre-warms a
TanStack Query cache with HydrationBoundary, the client reads with useQuery, and a revisit
paints from cache immediately while it refetches in the background.

BUILD:
1. Rooms (hospitality/rooms): move the grid's data into a query key
   ['rooms', eventId, venueId]. staleTime 30 s, gcTime 10 min, placeholderData keepPrevious
   so switching venue never blanks the grid. Room moves keep their existing optimistic
   update + rollback, now writing into this cache.
2. Home (page.tsx already dehydrates 'board'): make every other Home block read from a query
   too, so a revisit is 0 network waits.
3. Prefetch on intent: when Home renders, prefetch the rooms and call-queue queries and
   router.prefetch their routes, after first paint (requestIdleCallback, with a setTimeout
   fallback for the WebView). Never block Home's paint for it.
4. Realtime: where the screen already subscribes to Supabase Realtime, the subscription now
   invalidates or patches the query cache instead of refetching the page.

Files you may change: v2 hospitality/rooms/**, v2 page.tsx and its _components, src/lib/query
keys module if one exists (create src/lib/queries/keys.ts if not), tests.

Done when: re-run S0. Rooms second visit <= 300 ms to real content, first visit <= 2 s on the
4g profile; Home second visit <= 300 ms. Report before/after.
```

## S4 — Tapping a family feels instant

```
[PREAMBLE]

TASK: The worst number in FEEL-BASELINE: tapping a family shows nothing for 3.2 s. Make the
family record appear the moment it is tapped.

BUILD:
1. The family record (rsvp/status/[groupId] and the guest record it links to) reads from a
   query ['family', eventId, groupId].
2. placeholderData: take the row the user just tapped from the list cache (guests list or
   call queue) so the header — name, phone, PAX, RSVP chip — renders instantly. The rest of
   the record fades in (opacity 0 -> 1, 150 ms) when the full query resolves. Never show a
   skeleton for data the phone already has.
3. Prefetch on press-down: in the list rows, on pointerdown (not click) call
   queryClient.prefetchQuery for that family and router.prefetch its route. Pointerdown
   gives ~100-150 ms head start before the click fires.
4. Back from the record restores the list at the same scroll position with the same filters
   (store scrollY per list key in sessionStorage; restore after the list paints).

Files you may change: the family record route(s) and their components, the guest list and
call queue row components, src/lib/queries/keys.ts, tests.

Done when: re-run S0. M1 <= 100 ms, M2 <= 300 ms, M5 back-to-list <= 150 ms on the 4g
profile. Report before/after.
```

## S5 — Open the app with yesterday's data already on screen

```
[PREAMBLE]

TASK: When a runner opens the app on bad venue Wi-Fi, show the last known data immediately
and refresh in the background, instead of a blank screen.

BUILD:
1. Persist the TanStack Query cache to IndexedDB with the `idb` package already in
   package.json (no new dependency): dehydrate on a 1 s debounce after cache changes,
   hydrate before the first query runs. Key it by event id AND staff/session identity so
   one phone never shows another event's or another login's data. Max age 24 h. Clear it on
   sign-out and when the access code is revoked (session_code_live false).
2. Only persist queries that are safe to show stale: board, call queue, guests list, rooms,
   arrivals, departures, hampers. Never persist anything with a signed URL or a token.
3. While data on screen came from the persisted cache and has not refreshed yet, show a small
   "Updating..." chip reusing SyncChip's styling — never a blocking spinner.
4. Vitest: a persisted cache for event A is never hydrated into a session for event B.

Files you may change: src/lib/queries/persist.ts (new), the QueryClient provider, SyncChip
usage, sign-out path, tests.

Done when: kill the network in devtools, reopen the app, Home and Rooms show the last data
with the "Updating..." chip; restore the network and it clears. Report what you verified on a
real phone and what only in the browser.
```

> **Region decision (not a prompt, needs you):** functions run in Seoul next to the database,
> and the phone is in India. S2-S5 remove most of the round trips so this matters far less.
> Measure from a real phone on mobile data after S5 (`/api/version` TTFB). If it is still
> > 800 ms, the fix is a Supabase project in Mumbai (`ap-south-1`) plus Vercel `bom1` — a
> dump/restore, planned for a day with no live event.

---

# PHASE B — Make it feel good

## M1 — The motion system

```
[PREAMBLE]

TASK: One small motion vocabulary the whole app uses, so every screen moves the same way.

BUILD src/lib/motion/tokens.ts and use it everywhere motion is added later:
- durations: tap 90 ms, quick 160 ms, standard 220 ms, emphasis 320 ms. Nothing longer.
- springs (motion `transition` objects): snappy { type: 'spring', stiffness: 520,
  damping: 38, mass: 0.9 } for presses and chips; sheet { stiffness: 380, damping: 36 } for
  sheets and cards entering; gentle { stiffness: 220, damping: 30 } for numbers settling.
- easing for CSS transitions: --ef-ease-out cubic-bezier(0.2, 0.8, 0.2, 1),
  --ef-ease-in cubic-bezier(0.4, 0, 1, 1). Put them in globals.css next to the other tokens.
- a `useReducedMotion()`-aware helper so every token collapses to duration 0.

Then add three shared components on top of the existing MotionProvider (LazyMotion,
domAnimation — keep it; do not import domMax):
1. <ScreenTransition> in the v2 [eventCode] template.tsx (create it): the main column enters
   with opacity 0 -> 1 and translateY 8px -> 0 over `standard`. Tab-bar switches crossfade
   only (no slide) — tabs are peers, not a stack.
2. <Sheet> — replaces bottom sheets: scrim fades in (quick), panel rises with the `sheet`
   spring from translateY 100%, closes by tapping the scrim, the handle, or pressing back
   (Capacitor App backButton listener + popstate). Focus trapped while open.
3. <SuccessMark> — a check that draws its stroke (pathLength 0 -> 1, standard) with a single
   scale pulse 0.9 -> 1 (snappy). Used after a save.

Convert the existing bottom sheets (hospitality/rooms/_components/RoomSheet.tsx,
PlaceFamilySheet.tsx, rooming-list/_components/RoomingRoomSheet.tsx, the rooms filter sheet)
to <Sheet>. No other visual change in this prompt.

Files you may change: src/lib/motion/**, src/components/motion/**, globals.css (tokens only),
the v2 [eventCode] template.tsx (new), the listed sheet components.

Done when: every sheet opens and closes with the spring at 60 fps on a mid Android phone
(Chrome remote debugging Performance trace, no long tasks > 50 ms during the animation);
reduced-motion makes all of it instant. Report the trace numbers.
```

## M2 — Dark mode with a toggle (light stays the default)

```
[PREAMBLE]

TASK: Add a dark theme and a toggle. Light remains the default because staff read screens in
daylight. Every colour already comes from --ef-* tokens in globals.css, so this is a token
set, not a rewrite.

BUILD:
1. globals.css: a `[data-mode='dark']` block redefining EVERY --ef-* colour token for the
   staff theme, and a `[data-theme='client'][data-mode='dark']` block for the client theme.
   Direction: CRED-like — near-black ground (#0d0f10 range), raised surfaces 2-3 steps
   lighter, hairline borders, one accent kept from the brand, shadows replaced by lighter
   surface steps (shadows vanish on dark). Every text/background pair must meet WCAG AA
   (4.5:1 body, 3:1 large); write a vitest that parses the token blocks and checks the
   contrast of each text token against each surface token it is used on.
2. Mode control with three states: Light (default), Dark, System. Stored with
   @capacitor/preferences (same mechanism as src/lib/native) AND mirrored to localStorage
   (inside try/catch) so an inline script in the root layout can set data-mode before first
   paint — no white flash when a dark-mode user opens the app. Also set <meta
   name="theme-color"> and the Capacitor StatusBar style to match (StatusBar plugin already
   installed; no APK rebuild needed).
3. The toggle lives in the existing settings/"?" area as a three-segment control using
   Pressable. Switching animates a 220 ms crossfade of background colours only.
4. Check every v2 screen in both modes at 390x844 and list any hard-coded colour you had to
   replace with a token.

Files you may change: globals.css, the root layout (inline script + meta only),
src/lib/theme/mode.ts (new), the settings/help screen, any component that hard-codes a
colour (replace with a token only), tests.

Done when: all v2 screens render correctly in light and dark, no flash on cold start in dark
mode (record a screen video on a phone), contrast test passes.
```

## M3 — Home that says what to do next

```
[PREAMBLE]

TASK: Make Home one clear next action, CRED-style: one hero card, a few big tiles, nothing
that needs explaining.

BUILD in the v2 Home (page.tsx and _components):
1. Hero card at the top: the single most urgent job for THIS staff member's department,
   taken from the existing attention data (confirmedNoRoom, arrivalsNoVehicle, noDeparture,
   hampersPending, next family to call). Big verb-first title ("Call the Mehta family"),
   one line of why, one primary button. Tapping it goes straight into the task.
2. Below it: at most 4 tiles for the department's other jobs, each with a count that
   counts up from 0 to its value on first paint (gentle spring, only when the number is
   fresh — not on every revisit).
3. Progress: one ring or bar for the day ("142 of 238 families called") animating from the
   previous known value to the new one, not from 0.
4. Everything else that is on Home today moves behind a "More" row at the bottom. Admin-only
   and debug links never appear for event_team.
5. Staggered entrance: hero, then tiles 40 ms apart, then the rest (standard duration,
   opacity + 8px rise). Only on the first open of the session.

Read first: docs/UX-RULES.md, docs/GLOSSARY.md (use plain words: "families", "rooms",
"hampers"), src/lib/departments.ts.

Files you may change: v2 page.tsx and its _components only.

Done when: a person who has never seen the app can say, within 5 seconds of opening Home,
what they should do next (do it with one real person; write their answer in the report).
```

## M4 — The call flow: fastest path through the most-used screen

```
[PREAMBLE]

TASK: Calling families is what staff do all day. Make one call take the fewest taps and feel
rewarding.

BUILD in the v2 RSVP call flow (rsvp/queue, rsvp/call/[groupId], rsvp/status/[groupId]):
1. The call screen is one big card: family name, phone, PAX, last outcome, and one large
   green "Call" button in the thumb zone. Opening it from the queue uses the S4 instant
   pattern.
2. After the call returns (app resume), the five outcome buttons (Coming / Not coming /
   Maybe / No answer / Call back) slide up as a grid of large targets (>= 64px high). One tap
   saves optimistically, shows <SuccessMark>, and after 600 ms auto-advances to the next
   family in the queue with a horizontal slide (the only place a horizontal transition is
   used, because it IS a sequence). An "Undo" chip stays for 5 s.
3. "Call back" opens a <Sheet> with three quick choices (in 1 hour, this evening, tomorrow
   morning) plus a custom time — no date picker first.
4. The queue shows a thin progress bar at the top ("37 left today") that moves after each
   outcome.
5. Keep every existing rule: the caller lock is claimed/released on the status screen only
   (CLAUDE.md §6), call_attempts is written before tel: fires, the row freezes on outcome.
   Read CLAUDE.md §6 and §12 before touching anything.

Files you may change: the v2 rsvp call-flow screens and their components only.

Done when: a full call (open family -> call -> log "Coming" -> next family on screen) is
<= 4 taps and the app shows the next family within 700 ms of the outcome tap on the 4g
profile. scripts/tap-budget.mjs (the V12 tap-budget runner) passes its RSVP task within budget.
```

## M5 — Small things that make it feel finished

```
[PREAMBLE]

TASK: Polish pass across the v2 screens using only the M1 tokens and components.

1. Skeleton -> content: crossfade (quick) instead of a hard swap; skeletons only for data
   the phone has never had (S3-S5 mean this is rare).
2. Toasts: one <Toast> region above the tab bar; success/undo/error, spring in from below,
   auto-dismiss 4 s, swipe down or tap to close. Errors follow UX-RULES R6 (what happened,
   what to do, who to ask).
3. Empty states: a simple line illustration (inline SVG, token colours) + one sentence + one
   action button, for rooms, hampers, arrivals, departures, call queue.
4. Pull to refresh on list screens: a custom indicator that follows the finger (pointer
   events + transform only), releases with the snappy spring, and invalidates the screen's
   query. Must not fight the WebView's native overscroll — disable overscroll-behavior on
   the list container.
5. Numbers that change (PAX, counts, "x left") animate between old and new value (gentle).
6. Haptic tick on success and on outcome taps: use navigator.vibrate(12) when available and
   the user has not turned it off. Do NOT add the Capacitor Haptics plugin in this prompt —
   that needs an APK rebuild; note it as a follow-up.

Files you may change: src/components/ui/**, src/components/motion/**, the v2 screens' empty
states and list containers.

Done when: every item above works at 360px and 390px in light and dark; a Performance trace
of pull-to-refresh and a toast on a mid Android phone shows no dropped frames beyond 2.
```

## M6 — Hide the developer parts from staff

```
[PREAMBLE]

TASK: The app "feels made for developers" partly because developer surfaces leak into staff
screens. Find and remove them for event_team and client sessions (admins keep them).

1. Grep src/app/(app)/v2 and src/components for: debug links (/debug, harvest-debug,
   pipeline), raw ids or uuids rendered as text, error reference codes shown large, SQL/PG
   error codes (23514, 40001, PGRST) in user-facing text, "extraction", "pax", "leg",
   "deliverable" in JSX text (docs/GLOSSARY.md has the replacements), JSON dumps, version
   hashes.
2. For each: hide it for non-admin roles, or replace it with the plain-language equivalent.
   Error references stay available but small and last (ErrorReference.tsx), per UX-RULES R6.
3. Specific known case: a rooms swap that hits 23514 must say "Empty one room first, then
   move the family" instead of offering the capacity override (CLAUDE.md §14 known gap).
4. List every change in the report as: screen | what a staff member saw before | what they
   see now.

Files you may change: v2 screens and src/components (user-facing strings and role checks
only). Do not change any value compared with === or stored in the database.

Done when: the grep in step 1 finds nothing visible to an event_team session; typecheck,
tests and build pass.
```

---

# P-FINAL — Prove it

```
[PREAMBLE]

TASK: Re-measure everything and decide whether the series worked.

1. Production build, node scripts/feel-baseline.mjs, both profiles. Add a new dated section
   to docs/FEEL-BASELINE.md with a before (S0) / after table for every metric.
2. Run node scripts/tap-budget.mjs (the V12 tap budgets) in light and dark mode.
3. Update docs/HANDSET-TEST.md with a 10-minute script for a real phone: open app cold on
   mobile data, open Rooms twice, tap 5 families, log 3 call outcomes, toggle dark mode,
   pull to refresh, go offline and reopen. Stopwatch column for each.
4. Write docs/FEEL-REPORT.md: every budget in INTERACTION-CONTRACT with PASS/FAIL and the
   measured number, and the three slowest things left with the file responsible.

Files you may change: docs/FEEL-BASELINE.md, docs/HANDSET-TEST.md, docs/FEEL-REPORT.md,
scripts/tap-budget.mjs (mode parameter only).

Done when: FEEL-REPORT.md exists with real numbers. A FAIL is a valid result — it names the
next thing to fix.
```

---

## Running order

| # | Session | What changes for a staff member |
|---|---|---|
| S0 | Measure | Nothing yet — honest numbers to beat |
| S1 | Instant press | Every tap visibly responds immediately; no more double taps |
| S2 | One round trip | Every screen starts loading ~2 DB trips sooner |
| S3 | Rooms + Home cache | Rooms and Home open instantly on return |
| S4 | Instant family | Tapping a family shows it at once |
| S5 | Offline start | Opening on bad Wi-Fi shows the last data, not a blank screen |
| M1 | Motion system | Sheets, screens and success all move the same smooth way |
| M2 | Dark mode | Light by default, Dark/System toggle, no flash |
| M3 | Home | One clear next job |
| M4 | Call flow | A call is 4 taps and moves to the next family by itself |
| M5 | Polish | Toasts, empty states, pull to refresh, numbers that move |
| M6 | Hide dev stuff | No codes, ids or debug links for staff |
| P-Final | Prove it | Before/after numbers and a phone test |

**Do not deploy M-prompts during a live event** (CLAUDE.md: no changes while an event is
running). UNICOS279 runs 1-4 October: either finish S0-S3 before 30 Sep and freeze, or start
after 4 Oct.

**Check yourself after each session:** open the deployed app on a real Android phone. The
S-prompts must feel faster before any M-prompt starts; if S3/S4 don't hit their numbers,
fix that first — motion on a slow app makes it feel worse.
