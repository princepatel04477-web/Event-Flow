# FEEL progress

Standing loop file. Source of truth for tasks: `docs/FEEL-PROMPT-SERIES.md`.
Pick the first unchecked item whose phase is allowed today (`date`).

- Phase A: allowed now, before the 30 Sep freeze.
- Phase B: only when today is **>= 2026-10-05** (UNICOS279 runs 1–4 Oct).
- Never: any live DB change, Vercel deploy, env/secret change, and the
  `route_context` migration push (owner does it 5 Oct).

Vocabulary is frozen: `src/lib/motion/tokens.ts` keeps DURATION 100/150/280,
EASE ledger/seal and the one SPRING. No new animation libraries.

## Phase A — allowed NOW (before 30 Sep freeze)

- [x] G1  S4 gap: replace record-screen placeholder with real empty/loading state
      `96e5a2a` — added `src/app/(app)/v2/[eventCode]/rsvp/status/[groupId]/loading.tsx`,
      a skeleton shaped like the record (identity card, five outcome chips, notes
      field). Left open: rendering the header from the tapped row needs the record
      converted to a client query consumer (shares the v1 screen, claims the lock).
      PHONE CHECK: open a family from Calls and confirm the skeleton matches the
      real record with no jump.
- [ ] G2  S4 gap: prefetch route data on pointerdown (not just hover) for list rows + tab bar
- [ ] G3  M1 gap: add SuccessMark to the remaining confirm spots; add a perf trace note for tap→sheet
- [ ] G4  M2 gap: in-situ colour audit, every screen in light AND dark, fix any hardcoded colours to --ef-* tokens
- [x] M6  Hide developer surfaces
      `a4798d1` — debug pipeline route is admin-only; review title/loading say
      "call notes"; rooms MOVE capacity says "Empty one room first". Phone check:
      try `/{event}/debug/pipeline` as a team login (should bounce).

## Phase B — ONLY after 4 Oct (skip if today < 2026-10-05)

- [ ] M3  Home rebuild
- [ ] M4  Call flow rebuild
- [ ] M5  Polish pass
- [ ] G5  S5 gap: staff-identity scope
- [ ] PF  P-Final

## Blockers

(none yet)
