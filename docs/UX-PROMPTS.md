# EventFlow — "A 14-Year-Old Can Use It" Prompt Series

For **Command Code running DeepSeek V4 Flash Max** against this repo (`C:\dev\EventFlow`).

Run **one prompt per session**, in order. Commit between each. Do not merge two prompts
into one session — a Flash-class model drifts when the scope is wide, and every prompt
below is deliberately narrow enough to finish and verify in one go.

---

## What the audit actually found

These prompts are not generic UX advice. They fix what is really in this codebase today:

| # | Problem found in the code | Why it hurts a new user | Fixed by |
|---|---|---|---|
| 1 | **Two copies of six screens.** `queue/`, `review/`, `deliveries/`, `checkin/`, `departures/`, `arrivals/` exist BOTH at the event root and inside their section (`rsvp/queue`, `hospitality/deliveries`, …) and are byte-identical. `fleet/` and `call/[groupId]/` exist twice and have **diverged**. | The dashboard tiles link to the root copies (`/EVENT/queue`), but `SECTIONS` in `src/lib/sections/config.tsx` defines the section copies (`/EVENT/rsvp/queue`). So tapping a tile lands you on a page where **the bottom tab does not light up and the section strip vanishes**. The user is lost and cannot tell why. | P1 |
| 2 | **A client has one screen and no tabs.** `layout.tsx` sets `showTabs = access !== 'client'`, so the client gets no bottom bar at all. `SECTIONS.dashboard` lists `client` as a role, but `dashboard/page.tsx` calls `requireStaff` and bounces them. Road View (SRS §8), room number, and hamper status — the three things a client actually wants — have no screen. | The bride's family logs in and sees a guest list. Nothing else. | P6 |
| 3 | **Trade language everywhere.** `pax`, `deliverable`, `extraction`, `unmatched`, `harvest`, `ledger`, `travel leg`, `roomed`, tab labels `Board` / `Prep` / `Stay`. | None of these are words a new person knows. "Stay" is the rooms tab; "Board" is the home screen. | P0 + P3 |
| 4 | **No way to find one person.** Search exists inside 8 separate screens, but there is no single "where is the Sharma family?" box. | The first instinct of every new user is to type a name. There is nowhere to type it. | P4 |
| 5 | **Home is a wall of counters.** `dashboard/page.tsx` leads with total pax and six stat tiles. `AttentionPanel` has the actionable data (`confirmedNoRoom`, `arrivalsNoVehicle`, `noDeparture`, `hampersPending`) but sits below the fold. | A runner opening the app needs "what do I do next", not "how many people are coming". | P5 |
| 6 | **Detail screens have no way back.** `StickyHeader` shows the event name, not the screen name; `rsvp/status/[groupId]`, `deliveries/[id]`, `hamper/[id]` give no back control and no section strip. | Drill in twice and the only escape is the phone's back gesture. | P2 |
| 7 | **`MoreSheet.tsx` is dead code.** 127 lines, fully built, imported by nothing — `BottomTabs` has no More button. | Screens that are not one of the 5 tabs are only reachable from links buried in the dashboard. | P2 |
| 8 | **Wrong recovery offered on a room swap.** CLAUDE.md §14 records it: swapping two full rooms raises `23514`, and the UI answers with the capacity **override** sheet — which would force an over-capacity commit. The right answer is "empty one room first". | The app suggests the dangerous option to someone who does not know better. | P7 |
| 9 | **No undo anywhere** except the rooms grid. | A wrong tap on "delivered" is permanent — `delivery_proofs` is insert-only by design (§5.2), so the UI must prevent the mistake, not fix it after. | P7 |
| 10 | **No first-run anything.** `WelcomeOverlay.tsx` (261 lines) exists and is not used as onboarding. | Nobody is ever told what the app is for. | P8 |

**What is already good — do not "improve" it:** the error and empty-state writing voice
(honest, tells you who to ask), 44px tap targets, the 480px mobile column, the role theming
(`data-theme="client"`), and the code comments explaining *why*. Every prompt below says to
match that voice, not replace it.

---

## How to run a session

Paste this **preamble** at the top of every prompt below. The model starts each session
cold; without the frame it will invent its own conventions.

```
You are working in C:\dev\EventFlow — a Next.js 16 / React 19 / Supabase / Capacitor
app for running Indian wedding guest operations on cheap Android phones over bad venue Wi-Fi.

Before you write any code:
1. Read CLAUDE.md sections 5, 7, 12 and 14. They are house rules, not suggestions.
2. Read docs/UX-RULES.md and docs/GLOSSARY.md. Every change must satisfy them.
3. Read only the files listed in "Read first" below. Do not explore the whole repo.

Hard limits for this session:
- Change ONLY the files listed in "Files you may change". If the task seems to need a file
  that is not on that list, STOP and report which file and why. Do not change it.
- Do NOT write or run database migrations. Do NOT touch supabase/, src/lib/supabase/,
  or anything to do with RLS. If the task needs new data from the database, STOP and
  report exactly which column or view is missing.
- Do NOT add npm dependencies.
- Do NOT reformat, re-indent, or "tidy" code you are not changing. Keep every existing
  comment — the comments in this repo record why things are the way they are.
- Keep it mobile-first: base font 16px, tap targets >= 44px, one 480px column.

When you are done:
- Run `npm run typecheck` and `npm run lint`. Both must pass.
- Show me `git diff --stat`.
- Write what you changed and why into DECISIONS.md (append, do not rewrite the file).
- Tell me in plain words: what a user can now do that they could not do before.
```

**After every session:** commit, then open the app on a real Android phone
(`npm run mobile:dev`) — CLAUDE.md §14. A green typecheck is not a verified change.

---

# PROMPT 0 — Write the rules down first

*No app code changes. This session produces the two files every later prompt reads.*

```
[PREAMBLE — but skip step 2, you are creating those files now]

TASK: Create docs/UX-RULES.md and docs/GLOSSARY.md. No changes to any file under src/.

CONTEXT: This app is used by three kinds of people, and right now it is written for the
first kind only:
  1. Back-office coordinators — laptops, bulk data entry, they know the jargon.
  2. On-ground event staff — a runner at a venue, one hand, phone, in a hurry, may be
     using the app for the first time that morning with no training.
  3. The client — the bride's or groom's family. Non-technical, often the oldest user,
     reading in a hotel lobby. Zero training, read-only.

The standard we are building to: a 14-year-old handed the phone with no explanation can
do the job on the screen. If they have to ask what a word means, or cannot tell what to
tap, the screen has failed.

FILE 1 — docs/UX-RULES.md. Write these eight rules, each with a one-paragraph explanation
and a concrete right/wrong example taken from THIS app (read the files listed below to get
real examples, do not invent screens that do not exist):

  R1. One job per screen. A screen names the one thing it is for in its title, and its
      primary action is the biggest tappable thing on it.
  R2. Plain words only. Every noun on screen is a word a guest would use. The glossary
      is the authority. Trade terms survive only in Excel column headers.
  R3. Never a dead end. Every screen has a visible way back and a visible next step.
      Empty states say what to do, not just that there is nothing.
  R4. Every number is a door. A count on screen links to the list it counts.
  R5. Undo, don't confirm. Reversible actions happen immediately with an Undo. Only
      irreversible actions (a sealed delivery proof) get a confirmation.
  R6. Tell the truth about failure. Say what happened, what to do now, and who to ask.
      Never a bare error code. Match the voice already in
      src/app/(staff)/[eventCode]/dashboard/page.tsx and src/components/ui/EmptyState.tsx.
  R7. Thumb-sized and daylight-legible. >= 44px targets, 16px base, high contrast,
      nothing that needs two hands.
  R8. It works when the Wi-Fi doesn't. Every write says whether it is saved on the phone
      or saved for real. Reuse src/components/ui/SyncChip.tsx.

FILE 2 — docs/GLOSSARY.md. A table with columns: Term in code | What to show a user |
Where the code word may stay. Fill it from the real vocabulary in this repo. Start with,
and verify against the code, at least these:

  pax                -> "guests" (a number of people). Keep "PAX" ONLY as an Excel column
                        header in src/lib/export/, because the client's own sheets use it.
  group / guest_group-> "family"
  deliverable        -> "hamper" or "return gift" — use the specific one, never the umbrella
  extraction         -> "call notes"
  unmatched          -> "unknown numbers"
  harvest            -> "imported recordings"
  travel leg         -> "arrival" or "departure"
  roomed             -> "has a room"
  Board (tab label)  -> "Home"
  Stay (tab label)   -> "Rooms"
  Prep (tab label)   -> "Setup"
  access code        -> "your code"
  event_team / client-> "team" / "family view"

Read the whole of src/lib/sections/config.tsx and grep the JSX in src/app and
src/components for any other trade term shown to a user, and add every one you find to
the table. Do not change any of them yet — P3 does that.

Read first:
  CLAUDE.md (sections 5, 7, 12, 14)
  src/lib/sections/config.tsx
  src/app/(staff)/[eventCode]/layout.tsx
  src/app/(staff)/[eventCode]/dashboard/page.tsx
  src/components/ui/EmptyState.tsx

Files you may change: docs/UX-RULES.md, docs/GLOSSARY.md, DECISIONS.md. Nothing else.

Done when: both files exist, every glossary row names a real file where the term appears,
and no file under src/ has changed (`git status` proves it).
```

---

# PROMPT 1 — One screen, one address

*The single biggest cause of "I don't know where I am". Do this before anything else.*

```
[PREAMBLE]

TASK: Every screen in this app must live at exactly ONE path, and every link in the app
must point at that path.

THE PROBLEM, verified: these page files are byte-identical duplicates —
  src/app/(staff)/[eventCode]/queue/page.tsx      == rsvp/queue/page.tsx
  src/app/(staff)/[eventCode]/review/page.tsx     == rsvp/review/page.tsx
  src/app/(staff)/[eventCode]/deliveries/page.tsx == hospitality/deliveries/page.tsx
  src/app/(staff)/[eventCode]/checkin/page.tsx    == hospitality/checkin/page.tsx
  src/app/(staff)/[eventCode]/departures/page.tsx == logistics/departures/page.tsx
  src/app/(staff)/[eventCode]/arrivals/page.tsx   == logistics/arrivals/page.tsx
and these two pairs have DIVERGED and must be diffed by hand before you touch them —
  src/app/(staff)/[eventCode]/fleet/page.tsx         vs logistics/fleet/page.tsx
  src/app/(staff)/[eventCode]/call/[groupId]/page.tsx vs rsvp/call/[groupId]/page.tsx
Also duplicated: review/[extractionId], rsvp/[groupId] vs rsvp/status/[groupId],
calls/unmatched vs rsvp/unmatched, departures/new vs logistics/departures/new,
guests/page.tsx vs guests/list/page.tsx, import vs guests/import, export vs guests/export,
hamper/* vs the hospitality deliveries screens. Enumerate them all yourself with
`find src/app -name "page.tsx"` and a diff — do not trust this list to be complete.

The canonical address of every screen is the one SECTIONS in src/lib/sections/config.tsx
defines: /{eventCode}/{section}/{child}. The root-level copies are the legacy ones.

STEPS, in this order:
1. List every duplicate pair and mark each IDENTICAL or DIVERGED. Show me the list before
   deleting anything.
2. For DIVERGED pairs only: diff them, and keep the version with the newer git log date,
   unless the older one has behaviour the newer lacks — in that case STOP and show me the
   diff before choosing.
3. Delete the legacy root-level page files and their private _components folders. Anything
   in a deleted _components folder that the canonical page still imports must MOVE, not be
   deleted — check every import first.
4. Replace each deleted route with a redirect so old links, QR codes and WhatsApp messages
   still work: a page.tsx that does `redirect(sectionPath(eventCode, 'rsvp', 'queue'))`
   and nothing else. Do not use next.config redirects — these paths are dynamic per event.
5. Fix EVERY internal link to build its href from sectionPath() / sectionHome() in
   src/lib/sections/config.tsx instead of a hand-written template string. The dashboard is
   the worst offender: its StatCards link to /queue, /arrivals, /deliveries and its
   "Event day" nav links to /checkin, /departures, /rsvp, /export — all legacy.
6. Add tests/routes.test.ts: a vitest test that fails if any .tsx file under src/ contains
   a hardcoded event-scoped path (a template literal matching
   /\$\{[a-zA-Z.]*[eE]vent[a-zA-Z.]*\}\/(queue|arrivals|departures|deliveries|checkin|review|fleet|export|import)\b/).
   This is what stops the duplication growing back.

Read first:
  src/lib/sections/config.tsx
  src/app/(staff)/[eventCode]/layout.tsx
  src/app/(staff)/[eventCode]/dashboard/page.tsx
  src/components/nav/BottomTabs.tsx
  src/components/nav/SectionTabs.tsx

Files you may change: anything under src/app/(staff)/, src/components/nav/,
src/components/dashboard/, plus tests/routes.test.ts and DECISIONS.md.
Do NOT change src/lib/ (other than reading it), supabase/, or any auth file.

Done when:
- `find src/app -name "page.tsx" | xargs md5sum | sort | uniq -d -w32` returns nothing.
- Every one of the six section tabs, from every screen reachable under it, keeps the
  bottom tab lit and the section strip visible. Check all of them.
- Tapping every tile and every link on the dashboard lands somewhere the tab bar agrees with.
- npm run typecheck, npm run lint and npm run test:run all pass.
```

---

# PROMPT 2 — You can always get back

```
[PREAMBLE]

TASK: From any screen in this app, the way back must be visible without using the phone's
back gesture, and the header must say which screen you are on.

THE PROBLEM: StickyHeader shows the event name and date range on every single screen, so
a detail route like /EVENT/rsvp/status/{groupId} or /EVENT/hamper/{deliverableId} gives no
clue where you are or how to leave. SectionTabs deliberately renders nothing on sections
with fewer than two children (Dashboard, Hamper), which is correct — but it means those
screens have no second landmark at all. And src/components/nav/MoreSheet.tsx is 127 lines
of fully-built, fully-accessible code that NOTHING imports.

STEPS:
1. Extend src/components/ui/StickyHeader.tsx with two optional props: `back` (an href) and
   `screenTitle`. When `back` is set, render a >= 44px back control on the left with an
   accessible label naming the destination ("Back to hampers", not "Back"). When
   `screenTitle` is set, it becomes the large line and the event name drops to the
   subtitle. Default behaviour with neither prop must be byte-identical to today.
2. Give every detail route a back href and a screen title. At minimum:
   rsvp/status/[groupId], rsvp/call/[groupId], rsvp/review/[extractionId],
   hospitality/deliveries/[deliverableId], hamper/[deliverableId],
   hospitality/rooms/new, hospitality/rooms/allocate, logistics/departures/new,
   guests/import, guests/export. Build the href with sectionPath().
3. Decide MoreSheet: either wire it up as a 6th "More" tab in BottomTabs listing every
   section and child not on the bar (Setup, Import, Export, Unknown numbers, Trips,
   Check-in/out, Excel export), or delete the file. Wire it up unless it does not fit —
   the screens it would expose are currently only reachable from dashboard links.
4. On the Hamper section (no children, so no section strip) add a plain screen title row
   so it is not the one screen with no landmark.

Read first:
  src/components/ui/StickyHeader.tsx
  src/components/nav/MoreSheet.tsx
  src/components/nav/BottomTabs.tsx
  src/components/nav/SectionTabs.tsx
  src/app/(staff)/[eventCode]/layout.tsx

Files you may change: src/components/ui/StickyHeader.tsx, src/components/nav/*,
and the page.tsx files of the detail routes listed above. Nothing else.

Done when: starting from any screen, a person can reach the section home in one tap and
the app home in two, without a back gesture; every header names the screen; typecheck,
lint and tests pass.
```

---

# PROMPT 3 — Say it in words a guest would use

*Copy only. Zero logic. This is the cheapest big win in the series — do not let it turn
into a refactor.*

```
[PREAMBLE]

TASK: Replace every trade term shown to a user with the plain word from docs/GLOSSARY.md.
Change display strings ONLY.

RULES FOR THIS SESSION — read them twice:
- You may change string literals that a user reads: JSX text, `label=`, `title=`,
  `placeholder=`, `aria-label=`, `description=`, metadata titles, and the `label` /
  `tabLabel` fields in src/lib/sections/config.tsx.
- You may NOT rename a variable, prop, type, function, database column, route segment,
  or file. `pax` stays `pax` in the code; it reads "guests" on screen.
- You may NOT change any string used as a key, a status value, an enum, a query
  parameter, or a value compared with === . If you are not certain a string is only ever
  displayed, leave it and list it in your report instead.
- Excel column headers in src/lib/export/ keep the client's own vocabulary, PAX included.
  That is deliberate: their existing sheets must still line up.

ALSO IN SCOPE, same rules:
1. Every button label becomes verb + object. "Submit" -> "Save room". "Confirm" ->
   "Mark hamper delivered". "Next" -> "Call next family". A label must make sense read
   on its own with the rest of the screen covered up.
2. Every empty state gets a next step. Match the voice already in
   src/app/(staff)/[eventCode]/dashboard/page.tsx — it explains what a zero means and who
   to ask. Copy that tone; do not write marketing copy.
3. Every error message answers three questions in one or two sentences: what happened,
   what to do now, who to ask if that fails. Keep any error reference code, but put it
   last and small — see src/components/ui/ErrorReference.tsx.
4. The five bottom tab labels get plain names (Board -> Home, Stay -> Rooms, Prep ->
   Setup, Travel stays, Hamper stays). Check each still fits the bar without truncating —
   BottomTabs has a comment explaining that a long label breaks the layout.

Read first:
  docs/GLOSSARY.md
  docs/UX-RULES.md
  src/lib/sections/config.tsx
  src/components/ui/EmptyState.tsx
  src/components/ui/ErrorState.tsx

Files you may change: any .tsx under src/app or src/components, plus the label fields in
src/lib/sections/config.tsx. Nothing else under src/lib.

Done when: `git diff` contains no renamed identifiers — every changed line is a string a
user reads. Grep the whole of src/app and src/components for "pax", "deliverable",
"extraction", "unmatched", "harvest" appearing inside JSX text and show me that the only
survivors are code identifiers. typecheck, lint and tests pass.
```

---

# PROMPT 4 — One box that finds anyone

```
[PREAMBLE]

TASK: Add one search that answers "where is the Sharma family?" from any screen.

THE PROBLEM: search exists eight times over — inside GuestsClient, ArrivalsClient,
CheckInClient, DeparturesClient, DeparturesBoard, ClientGuestList and the rooms grid —
and nowhere as a single front door. A new user's first instinct is to type a name, and
there is nowhere to type it.

BUILD:
1. A search control in StickyHeader, on every event screen, for every role. A magnifier
   icon >= 44px that opens /{eventCode}/find. Not a live dropdown — a full screen. On a
   cheap handset a full screen is faster and far easier to hit than a popover.
2. /{eventCode}/find: one big autofocused input, and results as you type (debounce 250ms,
   minimum 2 characters). Match on: guest name, family head name, mobile number (match on
   the last 4 digits too — staff know the last four, not the whole number), and room number.
3. Each result row shows, in this order: name, family, room number, RSVP status, arrival
   day. Tapping the row opens that family's record. Reuse src/components/ui/ListRow.tsx
   and src/components/ui/StatusPill.tsx — do not invent a new row style.
4. Roles: staff and admin search through the same source GuestsClient already uses
   (search_guest_profiles). A client searches through client_guest_profiles, exactly as
   ClientGuestList does, and their result rows do not link anywhere staff-only.
5. Empty query: show nothing but a hint line naming what can be searched. No results:
   say what was searched and offer the full guest list. Offline: say the search needs
   signal and offer the last-loaded guest list. Never a blank screen.

DO NOT: add a search index, add a dependency, write SQL, or create a database view. If
matching on the last 4 digits of a phone number cannot be done with the existing RPC,
STOP and tell me what is missing — do not filter a full table on the client.

Read first:
  src/app/(staff)/[eventCode]/guests/list/GuestsClient.tsx
  src/app/(staff)/[eventCode]/guests/list/_components/ClientGuestList.tsx
  src/components/ui/StickyHeader.tsx
  src/components/ui/ListRow.tsx
  src/lib/sections/config.tsx

Files you may change: a new src/app/(staff)/[eventCode]/find/ folder,
src/components/ui/StickyHeader.tsx, and DECISIONS.md. Nothing else.

Done when: from any screen, two taps and three letters find a family; a client can search
their own list; typecheck, lint and tests pass; tested on a real handset.
```

---

# PROMPT 5 — Home tells you what to do, not how many

```
[PREAMBLE]

TASK: Turn the event home screen from a scoreboard into a to-do list, without losing the
numbers.

THE PROBLEM: dashboard/page.tsx leads with total pax and six stat tiles. The genuinely
actionable data — confirmedNoRoom, arrivalsNoVehicle, noDeparture, hampersPending — is
already computed and handed to AttentionPanel, which sits below all of it. A runner who
opens the app needs the next job, not the guest count.

NEW ORDER on /{eventCode}/dashboard, top to bottom:
1. "Right now" — up to three cards, worst first, built from the attention numbers that are
   non-zero. Each card is one sentence naming the job, the count, and a single button that
   goes straight to the screen where the job gets done. For example:
   "12 families are confirmed with no room yet" -> [Give them rooms] -> rooms allocate.
   "4 arrivals today have no vehicle" -> [Assign vehicles] -> fleet.
   "9 hampers still to deliver" -> [Deliver hampers] -> hampers.
   If every attention number is zero, show one calm line — "Nothing needs you right now" —
   and go straight to the numbers. Do not show empty cards.
2. "Today" — arrivals today, departures today, hampers left today. Three figures on one
   row, each linking to its filtered list.
3. The existing headline pax figure and split bar, unchanged. Move it down; do not redesign it.
4. The existing six StatCards, unchanged apart from the link fix from P1.

RULES:
- Do not add a database read. Everything above comes from what readBoard() already returns.
  If a number you need is not in that payload, STOP and report which one.
- Keep the zero-guests empty state exactly as it is. It is well written and it works.
- Keep the closing note about live counters.
- The client does not reach this screen (requireStaff). Leave that alone — P6 handles the
  client home.

Read first:
  src/app/(staff)/[eventCode]/dashboard/page.tsx
  src/components/dashboard/AttentionPanel.tsx
  src/components/dashboard/StatCard.tsx
  src/lib/actions/dashboard.ts

Files you may change: the four files above plus DECISIONS.md. Nothing else.

Done when: the first thing on screen is a job with a button, not a number; a fresh event
with nothing pending still looks calm and correct; typecheck, lint and tests pass.
```

---

# PROMPT 6 — Give the family their own app

*The largest gap between the SRS and the code. Read the whole prompt before starting.*

```
[PREAMBLE]

TASK: Build the client experience. Today a client logs in and gets the guest list and
nothing else — layout.tsx sets `showTabs = access !== 'client'`, so they have no bottom
bar at all, and SECTIONS.dashboard claims a client role while dashboard/page.tsx bounces
them with requireStaff.

The client is the bride's or groom's family. They are the least technical user of this app
and the most important one to impress. They read it in a hotel lobby, often on an older
phone, and they want four answers: who is coming, where are they staying, when do they
land, has the hamper gone up.

BUILD — four client screens, all read-only, all under the existing data-theme="client"
warm-paper skin that layout.tsx already applies:

1. /{eventCode}/dashboard for a client — a client home, NOT the staff board. Four big
   figures only: families coming, guests coming, rooms given out, hampers delivered.
   Under them, "Arriving today" as a short list of names with times.
2. /{eventCode}/guests/list — already exists via ClientGuestList. Leave the data source
   alone; only apply the P2 header and P3 wording.
3. A rooms screen — every family, their hotel, their room number, check-in day. Grouped
   by family, sorted by name. This is SRS §7 "Client Access".
4. A "Road view" screen — SRS §8, exactly the fields it names: name, guests, room number,
   arrival time and day, travel mode, departure, family head, hamper, return gift. One
   card per family, biggest type in the app, no abbreviations at all.

NAVIGATION: give the client a bottom bar of their own — Home, Guests, Rooms, Road view.
That means changing the `showTabs` line in layout.tsx and adding client roles in
src/lib/sections/config.tsx. A client must never see a tab that bounces them: every tab in
their bar must lead to a screen whose guard permits a client. Verify each one by reading
its guard, not by assuming.

THE DATA — already checked for you, so do not go looking for more:
`client_guest_profiles` (see src/lib/supabase/database.types.ts, the view block) already
returns every field these four screens need:
  guest_name, family_head, group_type, side, pax, rsvp_status,
  hotel_name, room_number,
  arrival_date, arrival_time, arrival_mode, arrival_point,
  departure_date, departure_time, departure_mode, departure_point,
  hamper_delivered, needs_return_gift, return_gift_delivered
That is the whole of SRS section 8 Road View. **No migration and no new view is needed.**
  - Build every client figure by aggregating in TypeScript over the rows this view returns.
    Do NOT call readBoard() for a client: `v_event_board` returns a row of ZEROS to a
    client rather than zero rows, so the `!stats` fallback never fires and the family would
    be told "0 guests" for a 238-family wedding. dashboard/page.tsx has a long comment
    explaining exactly this trap — read it before you write the client home.
  - `search_guest_profiles` runs as the invoker and returns nothing at all to a client.
    Never use it on a client screen.
  - If you find you want a field that is not in the list above: STOP and report it. Do NOT
    write a migration, do NOT create a view, do NOT query another table as a workaround.

Read first:
  src/app/(staff)/[eventCode]/layout.tsx  (the whole file, including the comments)
  src/app/(staff)/[eventCode]/dashboard/page.tsx  (the requireStaff comment especially)
  src/app/(staff)/[eventCode]/guests/list/page.tsx  (the "do not put requireStaff back" comment)
  src/app/(staff)/[eventCode]/guests/list/_components/ClientGuestList.tsx
  src/lib/sections/config.tsx
  CLAUDE.md section 7 (roles and access model)

Files you may change: src/app/(staff)/[eventCode]/layout.tsx, src/lib/sections/config.tsx,
the client screens you create, and DECISIONS.md. Nothing under src/lib/supabase.

Done when: a client code logs in and lands on a home screen with four numbers and today's
arrivals; every tab in their bar opens without a bounce or a redirect loop; no staff screen
is reachable from any client screen; typecheck, lint and tests pass; tested on a real phone
with a real client code.
```

---

# PROMPT 7 — Make mistakes cheap

```
[PREAMBLE]

TASK: A wrong tap must be recoverable, and the app must never suggest the dangerous option.

There is no toast or undo component in this repo — src/components/ui has neither. Build one.

PART A — Undo instead of confirm.
1. Create src/components/ui/UndoBar.tsx: a bar above the bottom tabs, holding one message
   and one Undo button (>= 44px), auto-dismissing after 7 seconds, dismissible by tap,
   announced to screen readers with aria-live="polite". One at a time; a second action
   replaces the first and commits it.
2. Apply it to every reversible action, replacing any confirmation dialog on the same
   action: assigning or moving a room, assigning a vehicle, setting an RSVP outcome,
   marking a family checked in or out.
3. Do NOT apply it to sealing a delivery proof. CLAUDE.md §5.2: delivery_proofs is
   insert-only and not even the service role can delete one. That action keeps a real
   confirmation, and its confirmation must say plainly that it cannot be undone.
4. Undo must reverse the write, not just hide the message. If an action has no reverse
   available in src/lib/actions/, STOP and list it rather than faking the undo.

PART B — The room swap trap. CLAUDE.md §14 records this as a live product bug.
Swapping two full rooms (a1,a2 in A; b1,b2 in B; cap 2 each) raises Postgres 23514 because
the intermediate state is over capacity. src/lib/actions/rooms.ts catches 23514 in four
places and RoomsGridClient answers with the capacity OVERRIDE sheet — which would force an
over-capacity commit. Wrong, and dangerous in the hands of someone new.
  - Detect the swap case: the failing move's target room is already full AND the selected
    occupants come from a single other room.
  - In that case do not offer override at all. Say: "Room B is full. Move its guests out
    first, then bring these two in." and give one button that moves B's occupants to
    unplaced — after which the original move is retried automatically.
  - Genuine over-capacity (an extra mattress in a room that is not part of a swap) keeps
    the override sheet exactly as it is.

PART C — Say whether it saved.
Every write on a field screen shows its state honestly using the existing
src/components/ui/SyncChip.tsx: saved on this phone / sending / saved. Never a silent
success on a screen where the write is queued offline.

Read first:
  src/app/(staff)/[eventCode]/hospitality/rooms/RoomsGridClient.tsx
  src/lib/actions/rooms.ts  (the 23514 handlers around lines 590, 868, 968, 1041)
  src/components/ui/SyncChip.tsx
  src/lib/proof-queue.ts
  CLAUDE.md section 5 (rules 2 and 7) and section 14

Files you may change: src/components/ui/UndoBar.tsx (new),
src/app/(staff)/[eventCode]/hospitality/rooms/*, src/lib/actions/rooms.ts, the client
components of the screens listed in A2, and DECISIONS.md. Nothing under src/lib/supabase,
no migrations.

Done when: every reversible action can be taken back within 7 seconds; sealing a proof
still warns and still cannot be undone; a two-full-room swap offers "empty one room first"
and never offers override; typecheck, lint and tests pass; both room paths tested on a
real phone.
```

---

# PROMPT 8 — Teach on the screen, not in a manual

```
[PREAMBLE]

TASK: Nobody trains these users. The app has to teach itself, in place, in under a minute.

src/components/motion/WelcomeOverlay.tsx already exists (261 lines) and is not used for
onboarding. Reuse it — do not build a second overlay.

BUILD:
1. First run, once per device (store the flag with @capacitor/preferences, the same
   mechanism src/lib/native uses — not localStorage, which a WebView remount can lose):
   three cards, swipeable, skippable from the first one.
   Team: "Find anyone in two taps" / "Your jobs are on the home screen" / "Everything you
   tap is saved, even with no signal".
   Client: "Everyone coming to the wedding" / "Where they are staying" / "When they land".
   Never show it twice. Never block the app behind it.
2. A "?" control in StickyHeader opening one cheat-sheet screen: what each of the five tabs
   is for, one line each, plus who to call when something is wrong. One screen, no
   scrolling on a 6-inch phone.
3. Every empty state gets a working action, not just an explanation. The guest-list empty
   state already does this well — copy its shape onto the empty states for rooms, hampers,
   arrivals, departures and fleet.
4. The first time a screen is opened on a device, show a single one-line hint under the
   header naming the one thing to do there ("Tap a family to call them"). Dismiss on any
   tap; never show it again on that device. One hint per screen, maximum five words over
   the point.

DO NOT: build a tour library, add a dependency, dim the screen with a spotlight overlay,
or gate any action behind a tutorial step.

Read first:
  src/components/motion/WelcomeOverlay.tsx
  src/components/ui/EmptyState.tsx
  src/lib/native/  (how device-level preferences are stored)
  src/components/ui/StickyHeader.tsx

Files you may change: the files above, the empty states of the listed screens, and
DECISIONS.md.

Done when: a phone that has never opened the app gets three cards and then a working
screen; a phone that has opened it before sees nothing; the cheat sheet fits one screen;
typecheck, lint and tests pass.
```

---

# PROMPT 9 — Prove a 14-year-old can use it

```
[PREAMBLE]

TASK: Write the test that decides whether this whole series worked.

BUILD e2e/easy.spec.ts, running under the existing `phone` Playwright project (see
playwright.config.ts and how e2e/t2_offline.spec.ts is written). Seed with the existing
e2e/fixtures/generate.mjs + scripts/seed-543.mjs, exactly as `npm run test:acceptance` does.

Each task below is one test, and each asserts a TAP BUDGET — count actual clicks — as well
as passing. A test that completes in more taps than the budget FAILS. That is the point.

  Team session:
    1. Find the family "Sharma" from a cold start.                   <= 3 taps
    2. From the home screen, reach the job the app says is most      <= 2 taps
       urgent.
    3. Mark a hamper delivered, with a photo, from the home screen.  <= 5 taps
    4. Move a guest from one room to another.                        <= 5 taps
    5. Undo task 4.                                                  <= 1 tap
    6. Log an RSVP outcome for the next family in the call queue.    <= 4 taps
  Client session:
    7. Find my own room number.                                      <= 3 taps
    8. See who is arriving today.                                    <= 2 taps

Then one structural test that runs over every route in SECTIONS and every detail route:
  - every interactive element is >= 44 x 44 CSS px
  - computed body font-size >= 16px
  - the page has a visible back control OR is a section home
  - no more than 7 primary tappable actions in the main column
  - no horizontal scroll at 360px width (this app has had that bug twice — the comments
    in SectionTabs and the arrivals chip row record both)

Also write docs/HANDSET-TEST.md: the script for the human version of this test. Eight
tasks in plain English, a stopwatch column, and one instruction — hand the phone to
somebody who has never seen the app, say nothing, and write down every question they ask.
Every question they ask is a bug in the screen, not in them.

Read first:
  playwright.config.ts
  e2e/t2_offline.spec.ts
  e2e/fixtures/generate.mjs
  scripts/seed-543.mjs
  src/lib/sections/config.tsx

Files you may change: e2e/easy.spec.ts (new), docs/HANDSET-TEST.md (new), package.json
(one new script, `test:easy`), DECISIONS.md. Nothing under src/.

Done when: `npm run test:easy` runs green or fails with a named task and a tap count. A
failure here is the real result — it names the screen to fix next.
```

---

## Running order and why

| Prompt | Session | Depends on | What it buys |
|---|---|---|---|
| P0 | Rules and glossary | — | Everything after this has one standard to point at |
| P1 | One screen, one address | P0 | Navigation stops lying. **Highest impact — do first** |
| P2 | You can always get back | P1 | No dead ends |
| P3 | Plain words | P0 | Cheapest big win; do it while the code is still stable |
| P4 | One search | P1, P2 | The first instinct of every new user now works |
| P5 | Home tells you what to do | P1 | A runner opens the app and knows the next job |
| P6 | The family's own app | P1, P2, P3 | Closes the biggest SRS gap |
| P7 | Mistakes are cheap | — | Removes the fear that makes new people freeze |
| P8 | Teach on the screen | P2, P4, P5 | Under a minute from first launch to useful |
| P9 | Prove it | all | Turns "easy" into a number that fails a build |

P1 before everything: while a screen has two addresses, every other change has to be made
twice, and half your fixes will land on the copy nobody is looking at.

## If a session goes wrong

- **The model edits a file outside the list.** `git checkout -- <file>` and re-run the
  prompt with that file named in a "you may not change" line. This is the most common
  failure with a Flash-class model.
- **The model writes SQL or a migration.** Revert. Every prompt above says to stop and
  report a missing column instead. If a column really is missing, that is a decision for
  you, not for the agent.
- **The model rewrites working code it was not asked to touch.** Revert and split the
  prompt in half. Two narrow sessions beat one wide one every time on this class of model.
- **Typecheck fails and the model starts guessing.** Stop it. Paste the first error only,
  and nothing else. Chasing a cascade of type errors is where an unattended session burns
  an hour and leaves the tree broken.
- **You are not sure the change actually helped.** Run P9's handset test. Eight tasks,
  one stranger, a stopwatch. Every question they ask out loud is a bug.
