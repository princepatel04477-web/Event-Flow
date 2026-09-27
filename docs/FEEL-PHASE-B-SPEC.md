# FEEL Phase B spec (M3, M4, M5) - the full text the first pass did not have

## PREAMBLE (applies to every item)

You are working on EventFlow, a wedding/event operations app used by 10-20 staff on cheap
Android phones over bad venue Wi-Fi. Worktree: C:\dev\ef-int. Read CLAUDE.md first; its rules
override anything below. Also read docs/INTERACTION-CONTRACT.md and docs/FEEL-BASELINE.md.

Stack: Next.js 16.2 App Router (src/proxy.ts), React 19, TypeScript strict, Tailwind v4 with
tokens in src/app/globals.css (--ef-*), TanStack Query v5, Dexie/idb, `motion` 13 via
LazyMotion + domAnimation (src/components/motion, src/lib/motion), Supabase with RLS.
Screens live in src/app/(app)/v2/[eventCode]/**.

Rules:
- No `any`, no console.log, no stubs or TODOs. Every change works end to end.
- Do not rename routes, DB values, cookie/storage keys (CLAUDE.md §12: nuvent_* are FROZEN).
- Do not edit next.config.ts. Do not add dependencies.
- DB changes: a new timestamped file in supabase/migrations/ only. Do NOT apply it.
- Animate only transform and opacity. Never use motion's `layout` prop on lists.
  Respect prefers-reduced-motion. Use ONLY the existing src/lib/motion/tokens.ts vocabulary.
- Mobile first: at 360x740 and 390x844 nothing overflows, targets >= 44px, the tab bar never
  covers content.
- Verify: `npx tsc --noEmit`, `npx vitest run`, `npx eslint <files you touched>`. All green.
- Add tests for any new pure logic (hero-card selection, call-back time choices, etc).

## M3 - Home that says what to do next

TASK: Make Home one clear next action, CRED-style: one hero card, a few big tiles, nothing
that needs explaining. NOTE: upstream A3 dropped the old Today tiles and A7 added a PAX
headline - build on what is there now, keep the PAX headline, don't bring back the old tiles.

1. Hero card at the top: the single most urgent job for THIS staff member's department,
   taken from the existing attention data (confirmedNoRoom, arrivalsNoVehicle, noDeparture,
   hampersPending, next family to call). Big verb-first title ("Call the Mehta family"),
   one line of why, one primary button. Tapping it goes straight into the task.
   Put the choice of hero in a pure function with unit tests.
2. Below it: at most 4 tiles for the department's other jobs, each with a count that
   counts up from 0 on first paint (use the existing AnimatedNumber), only when fresh.
3. Progress: one bar for the day ("142 of 238 families called") animating from the
   previous known value, not from 0.
4. Everything else on Home moves behind a "More" row at the bottom. Admin-only and debug
   links never appear for event_team.
5. Keep the staggered entrance already added (HomeEntrance) - hero, then tiles 40 ms apart.

Files you may change: v2 page.tsx and its _components/_home only.

## M4 - The call flow: fastest path through the most-used screen

Already done in 74d4f58: SuccessMark + 600ms auto-advance, 64px outcome targets. Finish the rest:

1. The call screen is one big card: family name, phone, PAX, last outcome, and one large
   green "Call" button in the thumb zone.
2. Auto-advance to the next family uses a horizontal slide (the only horizontal transition
   in the app, because it IS a sequence). An "Undo" chip stays for 5 s and reverts the
   outcome optimistically (and on the server through the existing save path).
3. "Call back" opens the existing Sheet/BottomSheet with three quick choices (in 1 hour,
   this evening 7 pm, tomorrow 10 am) plus a custom time - no date picker first.
   Put the time maths in a pure function with unit tests (IST, Asia/Kolkata).
4. The queue shows a thin progress bar at the top ("37 left today") that moves after each
   outcome.
5. Keep every existing rule: the caller lock is claimed/released on the status screen only
   (CLAUDE.md §6), call_attempts is written before tel: fires, the row freezes on outcome.
   Read CLAUDE.md §6 and §12 before touching anything.

Files you may change: the v2 rsvp call-flow screens and their components only.

## M5 - Small things that make it feel finished

Already done in 91f9c69: haptic tick, AnimatedNumber count-up. Finish the rest:

1. Skeleton -> content: crossfade (quick fade token) instead of a hard swap.
2. Toasts: one Toast region above the tab bar (reuse an existing toast if the repo has one);
   success/undo/error, spring in from below, auto-dismiss 4 s, swipe down or tap to close.
   Errors say what happened, what to do, who to ask.
3. Empty states: a simple line illustration (inline SVG, token colours) + one sentence + one
   action button, for rooms, hampers, arrivals, departures, call queue. One shared
   EmptyState component.
4. Pull to refresh on list screens: a custom indicator that follows the finger (pointer
   events + transform only), releases with the spring, and invalidates the screen's query.
   Set overscroll-behavior: contain on the list container.
5. Numbers that change (PAX, counts, "x left") use AnimatedNumber.

Files you may change: src/components/ui/**, src/components/motion/**, the v2 screens' empty
states and list containers.
