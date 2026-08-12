# Product

<!-- impeccable:product-schema 1 -->

## Platform

web — a single responsive Next.js web app, mobile-first at 360px. The Android APK is a Capacitor remote shell over the deployed web app; the design language is web, not native (per the init platform rule: a native wrapper around a website does not make its design language native).

## Users

- **event_team (10–20 staff)** — callers, desk, hamper and logistics staff working on inexpensive Android phones at hotels, airports and venue gates, frequently one-handed, sometimes after dark, on unreliable venue Wi-Fi. Not technical; screens must work without instruction.
- **client** — the wedding family, read-only, one event. Desktop and mobile browsers.
- **admin** — the builder (Prince) and his partner; every event; the only role that can delete (never delivery proofs) and manage events/imports.

## Product Purpose

A centralised event-operations platform for a large Indian wedding (~238 family groups, ~465 guests): track every guest from first RSVP call through room allocation, hamper/return-gift delivery with photographic proof, airport transfers and departure. It replaces Excel sheets, Google Forms, paper calling registers, ad-hoc room charts and WhatsApp threads with one system where the event team and client see the same truth. Success = the wedding runs on it without the old spreadsheets, delivered and trained by the hard deadline of **26 August 2026**.

## Positioning

A multi-tenant platform where integrity is enforced in Postgres, not the app: every table is fenced by `event_id` with row-level security, delivery proofs are insert-only and immutable, server clocks override phone clocks, and machine output (transcripts/extractions) is evidence — only a human-reviewed commit becomes data. A neighbouring product could not truthfully copy "the database physically cannot be wrong".

## Operating Context

- Staff devices: Android 10+, Chrome / installed PWA / side-loaded APK (no Play Store; APK distributed over WhatsApp).
- Network: hotel Wi-Fi and 4G, both unreliable at the venue. Offline-tolerant, not offline-first: reads from cache, writes queued in IndexedDB, Postgres is always the source of truth.
- Calls are in Gujarati, Hindi and English, frequently code-switched mid-sentence; family names arrive off the sheet in Devanagari and sit inline with Latin.
- The calling unit is the family group, not the guest: one dial, the family head answers for several people; PAX lives on the group.
- Excel is an interface, not truth: the guest list changes repeatedly until close to the event, so import must be re-runnable and idempotent, with a preview and warning list before anything writes.
- Development happens on Windows; the repo must keep working there.
- The canonical project notes live in an **Obsidian vault inside the repo** at `eventflow/` (`.obsidian/`), holding `Nuvent.md`, `Project Brief.md`, `Prince's Brief (2026-08-05).md`, `Roadmap.md`, `Scope Cuts.md`, `Stack Decisions.md`, `Status.md`, plus `Database/`, `Ops/`, `Pipelines/`, `Sessions/`. It is the durable product knowledge base alongside this file.
- A second, personal Obsidian vault lives outside the repo at `C:\Users\rebel\OneDrive\Documents\prince_wiki\Prince_Wiki` — general dev/notes wiki, not product-specific.

## Capabilities and Constraints

- **Confirmed functionality:** Excel import/export; RSVP calling queue with claim locks; call logging, voice capture, STT + Claude extraction with a human review screen; room allocation across hotels; hamper/return-gift delivery with insert-only photo proofs; arrival/departure logistics with vehicles and trips; WhatsApp templated messaging; client read-only dashboard; admin event management; three roles (admin / event_team / client) enforced by RLS; multi-event support from day one.
- **Technical constraints:** Next.js App Router + TypeScript + Tailwind; Supabase (Postgres, Auth, Storage, Realtime); Capacitor APK (not Expo, not React Native); SheetJS; Sentry. Stack is locked — do not re-litigate.
- **Deadline:** submission 26 August 2026; feature freeze at the start of the final week.
- **Undecided:** deployment host (SRS named Vercel; nothing is deployed yet — deliberately uncommitted as of 9 Aug 2026).

## Brand Commitments

- Name: **Nuvent** (confirmed 9 Aug 2026). "Event Ops" (SRS title) and "EventFlow" (folder name) are historical names, not the brand.
- The app has an incumbent visual system (dark teal + brass staff theme, warm-paper client theme, self-hosted IBM Plex fonts incl. Devanagari) — recorded here as a brand fact, to be preserved or deliberately replaced by design work.

## Evidence on Hand

- `CALLING_MASTER_LIST.xlsx` — source guest data, ~238 family groups / ~465 guests.
- `SRS_EventOps_v1.md` — baselined requirements, the contract for Phase 1.
- `CLAUDE.md` — repository context; locked stack, architectural rules, known traps.
- `eventflow/` — Obsidian vault inside the repo: `Nuvent.md`, `Project Brief.md`, `Roadmap.md`, `Scope Cuts.md`, `Stack Decisions.md`, `Status.md`, `Prince's Brief (2026-08-05).md`, plus `Database/`, `Ops/`, `Pipelines/`, `Sessions/`.
- `DECISIONS.md` — decision log incl. the NuventPhone visual pass and its constraints.
- `test_security.sql`, `tests/`, `e2e/`, screenshots (`arrivals.png`, `deliveries*.png`, `fleet.png`, `rooms.png`, `queue.png`, `board.png`) — proof of behaviour at scale.
- No testimonials, press, case studies or customer quotes exist; future work must not fabricate them.

## Product Principles

1. **Integrity lives in the database, not the application** — RLS, triggers and constraints are the fence; app checks are usability conveniences only.
2. **Postgres is the truth; Excel is an interface** — no workflow may depend on a spreadsheet being current.
3. **Machine output is evidence; only human-reviewed commits are data** — nothing auto-writes from AI output.
4. **Resume-first, not continue-first** — any flow interrupted by the OS (dialling, camera, backgrounding) must recover from persisted state.
5. **Usable without instruction, by non-technical staff, at speed, in the dark, on cheap phones** — mobile-first always: base font 16px, tap targets ≥44px, legible under bad lighting.

## Accessibility & Inclusion

- Mobile-first: base font 16px, tap targets ≥44px, sticky header; works on a cheap Android phone on bad venue Wi-Fi.
- Text-on-surface pairs annotated with measured contrast ratios in `globals.css`; pass WCAG AA, most AAA.
- Devanagari (Gujarati) type loaded deliberately — family names in the register must render inline with Latin.
- State must not be conveyed by colour alone (room tiles differ in hatching/border/dots as well as hue); red = attention only, green = completed only.
- Motion collapses under `prefers-reduced-motion`; nothing depends on motion to convey state.
