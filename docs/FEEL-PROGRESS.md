# FEEL progress

**Phase A is COMPLETE.** Every allowed item is ticked. Nothing is left in
progress, so there is no `NEXT:` marker: the next thing to do is Phase B's M3,
and it is date-gated — Phase B unlocks when `date` reads **>= 2026-10-05**
(UNICOS279 runs 1–4 Oct). Re-pasting the standing prompt on/after that date
will pick M3 up from this file.

Standing loop file. Source of truth for tasks: `docs/FEEL-PROMPT-SERIES.md`.
Pick the first unchecked item whose phase is allowed today (`date`).

- Phase A: allowed now, before the 30 Sep freeze.
- Phase B: only when today is **>= 2026-10-05** (UNICOS279 runs 1–4 Oct).
- Never: any live DB change, Vercel deploy, env/secret change, and the
  `route_context` migration push (owner does it 5 Oct).

Vocabulary is frozen: `src/lib/motion/tokens.ts` keeps DURATION 100/150/280,
EASE ledger/seal and the one SPRING. No new animation libraries.

## Phase A — allowed NOW (before 30 Sep freeze)

- [x] MERGE upstream A1–A11 merged — `e3529df` (conflicts resolved per recipe; 838/838 green, no DB gating needed)

- [x] RCTX route_context migration now returns the A8 section locks — `c0567ca` (comment + returned shape corrected; TS caller + tests updated; NOT applied)

- [x] G1  S4 gap: replace record-screen placeholder with real empty/loading state
      `96e5a2a` — added `src/app/(app)/v2/[eventCode]/rsvp/status/[groupId]/loading.tsx`,
      a skeleton shaped like the record (identity card, five outcome chips, notes
      field). Left open: rendering the header from the tapped row needs the record
      converted to a client query consumer (shares the v1 screen, claims the lock).
      PHONE CHECK: open a family from Calls and confirm the skeleton matches the
      real record with no jump.
- [x] G2  S4 gap: prefetch route data on pointerdown (not just hover) for list rows + tab bar
      `4ffffc2` — new `PrefetchedLink`; Today's attention rows now arm a FULL
      prefetch on pointerdown/touchstart. The tab bar already did. The guest list
      is deliberately excluded (its destination claims the caller lock) and the
      call queue's rows do not navigate. PHONE CHECK: none.
- [x] G3  M1 gap: add SuccessMark to the remaining confirm spots; add a perf trace note for tap→sheet
      `91120c6` — CallScreen's "Outcome saved" now uses SuccessMark (the second
      and last spot with a check to replace; room placement has no check and
      hamper delivery already has its seal). FEEL-BASELINE.md now records how to
      take the tap→sheet trace. PHONE CHECK: log a call outcome and watch the
      check draw.
- [x] G4  M2 gap: in-situ colour audit, every screen in light AND dark, fix any hardcoded colours to --ef-* tokens
      `ee0d9cb` — audit found NO literal colour left in v2; the two exceptions
      were global: OfflineBanner (#a35408) and SentryErrorBoundary (five hexes).
      Both now use tokens, via a new `--ef-amber-fg` pair in all four blocks.
      722 tests. Still needs EYES in dark mode (the M2 phone check).
- [x] M6  Hide developer surfaces
      `a4798d1` — debug pipeline route is admin-only; review title/loading say
      "call notes"; rooms MOVE capacity says "Empty one room first". PHONE CHECK:
      try `/{event}/debug/pipeline` as a team login (should bounce).

## Phase B — ONLY after 4 Oct (skip if today < 2026-10-05)

- [x] M3  Home rebuild
      `65277f0` — the hero/bars/attention structure was already rebuilt by the
      merged tree (SPEC-V3 §4 / A3), so M3 added the one missing feel: a
      staggered rise+fade entrance (hero first, then each section 40ms later),
      played once per session via `claimHomeEntrance`. PHONE CHECK: open Home
      cold, then tab away and back — the entrance plays once, never on return.
- [x] M4  Call flow rebuild
      `74d4f58` — the call-flow structure was already rebuilt upstream (one
      family card, optimistic outcome buttons, auto-advance, callback sheet,
      progress bar). M4 added the missing feel: a SuccessMark + 600ms
      auto-advance on the one-tap outcomes (No answer / Not coming / Call back),
      and enlarged the outcome targets to 64px. PHONE CHECK: log "Not coming"
      and watch the check draw before the next family arrives.
- [x] M5  Polish pass
      `91f9c69` — haptic tick on success (SuccessMark) and count-up numbers
      (AnimatedNumber in Progress) landed. Toasts (UndoBar), empty states
      (EmptyState + icons) and rare skeletons (S3/S5) were already covered by
      the merged tree. Pull-to-refresh is the one item left: it needs a device
      for the pointer-tracking trace. PHONE CHECK: confirm the haptic tick on a
      save and the number glide on Home's "Families called" bar.
- [x] G5  S5 gap: staff-identity scope
      `4c7d9a5` — the offline query cache is now keyed by event code AND the
      selected staff member (read from the durable store; "anon" when there is
      none), so a shared handset never hydrates one login's rows into another's.
      PHONE CHECK: sign in as two different staff on one phone and confirm each
      cold open shows only their own login's cached Home.
- [ ] PF  P-Final

## Blockers

### BLOCKED: push + Vercel deploy (2026-09-26)

Asked to push and redeploy. **Not pushed, not deployed.** Two reasons, in order
of severity:

1. **`brain/showcase` has diverged.** Common base `d9bc4f0`. Local: 19 commits,
   44 files. `origin/brain/showcase`: **14 commits, 92 files** — an A1–A11 series
   (`A1` calling status, `A3` rename to Logistics/Hospitality + drop Today tiles,
   `A4` create rooms by quantity, `A5` one room filter sheet + remembered venue,
   `A6` rooming list, `A8` rsvp department **and DB-enforced section locks**,
   `A9` live arrival banner, `A10` desktop web portal, `A11` Files area). A push
   is rejected; force-pushing would destroy their 14. Overlap: **5 files**
   (`AppTabs.tsx`, `CallNext.tsx`, `RoomsBoard.tsx`, `layout.tsx`,
   `HelpScreen.tsx`).
2. **A merge was attempted and the suite went RED: 1 failed / 838** (was 722
   green). The failing test inserts `guest_groups` / `guests` /
   `room_assignments`, i.e. a DB-backed one; `tests/hotels.test.ts` passes 11/11
   in isolation, so it is order/parallelism-dependent or a new upstream test
   expecting migrations that are NOT applied (the Never list forbids applying
   them). Not diagnosed — no budget left. Rule 3 says do not proceed on red, so
   the merge was **aborted** and the branch is back at the green 19-commit state.

**The resolution is known, and short — redo it in a fresh session:**

- `layout.tsx` — take UPSTREAM's new imports (`LockedSectionBanner`,
  `ArrivalBanner`, `isArrivalsNotifyEnabled`) plus OUR `getRouteContext`, and
  `sidebarGroupsFor` plus `getViewer`. **Drop** `getStaffViewerContext`,
  `getEventAccess`, `resolveEventByCode`: the merged body uses
  `route.access` / `route.department`, so they are unused (lint will say so).
- `RoomsBoard.tsx` — imports: theirs' `type ReactNode` **and** our
  `keepPreviousData`. RoomCard: OUR `Pressable` wrapper **with** THEIR
  `OCCUPANCY_BORDER[status]` and THEIR richer `aria-label`; drop the
  `tap` / `active:bg-surface-2` classes, which `Pressable` now owns.
- `AppTabs.tsx`, `HelpScreen.tsx`, `CallNext.tsx` auto-merged cleanly.
- Method note: the two `[eventCode]` paths cannot be edited by the file tools
  after a merge (the bracket globs and the read tracker disagree). Resolve with
  a small node script doing exact literal replacements, then delete it.

**Also for 5 October:** `feat(A8)` added **DB-enforced section locks**, but
`20260926120000_route_context.sql` says "SECTION LOCKS — no such thing exists in
this schema". That comment, and possibly the RPC's shape, are now stale against
`brain/showcase`. Fix before the migration push.

**And after merging:** the 3 remaining feel prompts (M3, M4, M5) sit on screens
A3/A5 may have already redesigned — re-check each against the merged tree before
implementing.
