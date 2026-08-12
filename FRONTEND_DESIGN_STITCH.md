# Nuvent — Frontend Design Document for Google Stitch

Nuvent is field software for running a large Indian wedding (300–2,000 guests):
call families to confirm RSVPs, allocate rooms, arrange airport transfers and
hampers, and account for every guest's arrival and departure. Staff use it on
cheap Android phones in banquet halls, corridors, and hotel lobbies — often
one-handed, sometimes in the dark, with venue Wi-Fi that drops. It ships as an
APK (`viewport-fit=cover`) and is **mobile-first at 360px**, with a max content
width of **480px**. A guest-facing "client" role also logs in to read their
travel details.

This document is the single source of truth for the visual language. Generate
screens that look like they came out of this system — not a generic dashboard.

---

## 1. Design concept — "Organic" (Claude design system)

The app is restyled to the **Organic** design system (see
`Mobile app design request/_ds/organic-*/styles.css`): warm, rounded and a
little playful — a cream-and-sand ground with a **terracotta** accent and a
**sage** second accent, **Caprasimo** display headings over **Figtree** body,
16px+ radii that grow into **pills** and soft circular shapes. The redesign is
layered on top of the app's existing semantic structure (ledger statuses, red
margin rule, banded rows) — the metaphor survives, the surfaces soften.

Rules that fall out of the redesign — **do not break these**:

- **Paper is warm cream, never white.** `#f5ead8` — paper, not a screen.
- **Alternating list bands** are a shade lighter than the paper (`#eee5d0`).
- **Buttons, inputs, chips, segmented controls and status pills are full
  pills** (`border-radius: 999px`); cards are softly rounded (`~1.1rem`);
  nested row chips are 14px. No sharp corners, no hairline-only geometry.
- **The brand accent is terracotta `#c67139`** — selected filter chips,
  selected outcome tiles, active tabs, the focused ring, selection tint.
  In dark mode it lightens to `#d98d55` with a dark `#241409` label.
- **Sage `#7a8a5e` is a genuine second voice** (secondary accent).
- **Ledger red still means ATTENTION and only that** — overdue, over
  capacity, unbalanced, destructive, unreachable.
- **Ledger green still means COMPLETED and only that** — confirmed,
  delivered, balanced.
- **Every figure is set in mono with tabular numerals** so a column of room
  numbers or PAX counts lines up like a ledger column.
- **One red margin rule** runs down the leading edge of every list — the
  register's margin, rendered as a continuous vertical red line. Attention
  states "break into" it.
- **No page transitions, no scroll animations.** One 150ms fade is the only
  entrance; presses are 100ms colour shifts.
- **Dark mode follows the OS** — a "night ledger": warm near-black paper
  (`#151a22`), preserved ink cast, lighter terracotta brand.

## 2. Color tokens (light + dark)

**Paper / surfaces** (Organic cream-and-sand)

| Token | Light | Dark | Use |
|---|---|---|---|
| paper (page background) | `#f5ead8` | `#151a22` | Page background, list row base |
| paper-band (alternating row) | `#eee5d0` | `#1a212c` | Zebra band on odd rows |
| surface (cards) | `#fbf7ec` | `#1a212c` | Cards, inputs, chips |
| surface-2 (nested fill) | `#ebe1ca` | `#232b38` | Secondary fills, hovers, selected rows |

**Ink / text**

| Token | Light | Dark | Use |
|---|---|---|---|
| ink | `#201e1d` | `#e8e6df` | Primary text; also the primary button fill |
| muted | `#4a5568` | `#9aa4b2` | Secondary text, labels |
| subtle | `#5f6a79` | `#8b96a3` | Tertiary text, footnotes, placeholders |

**Rules (the ruled lines)** — ink at low alpha so they adapt to any surface:
- rule: `#201e1d14` light / `#e8e6df14` dark (hairlines, skeleton fills)
- rule-strong: `#201e1d26` light / `#e8e6df26` dark (borders, field outlines)

**Semantic colors** — the ledger's two meanings stay absolute:

| Token | Light | Dark | Meaning |
|---|---|---|---|
| ledger-red | `#9a1c1c` | `#f0716f` | ATTENTION: overdue, over capacity, unbalanced, unreachable, destructive |
| ledger-red-strong | `#7c1414` | `#f58a88` | Red hover/danger button |
| red-tint | `#fbe9e7` | `#3b1414` | Red pill background, red alert box |
| ledger-green | `#1e6f43` | `#7fd7a4` | COMPLETED: confirmed, delivered, balanced |
| ledger-green-strong | `#175632` | `#9ae3b8` | Green hover |
| green-tint | `#e6f2e9` | `#12331f` | Green pill background |

**Organic brand + support tones**

| Token | Light | Dark | Use |
|---|---|---|---|
| brand (terracotta) | `#c67139` | `#d98d55` | Selected chips/tabs/outcomes, focus ring, selection |
| brand-hover | `#b2622d` | `#e5a373` | Hover on selected |
| brand-strong | `#8c491a` | `#f6a06b` | Pressed/emphasis |
| brand-fg | `#fff9f2` | `#241409` | Text on terracotta |
| warning (amber) | `#a35408` | `#fcd34d` | "In hand / in progress / caution" |
| warning-tint | `#f9edd2` | `#3b2f12` | Amber pill/notice fill |
| info | `#0369a1` | `#7cc4ec` | Neutral information |
| info-tint | `#e2f1fb` | `#12293a` | Info pill fill |
| sage (accent-2) | `#7a8a5e` | `#aebf92` | Secondary accent voice |
| focus ring | ink | ink | `--ef-ring` |

**Text-on-surface contrast is verified to WCAG AA on every pair.** Client
login is read in a hotel lobby by the oldest user of the app.

## 3. Typography

| Role | Stack | Sizes |
|---|---|---|
| Sans (body, controls) | `"Figtree", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif` | 12px (xs, tertiary labels), 14px (sm, meta/secondary), **16px (base, body — never below; anything smaller makes iOS Safari zoom on focus)**, 20px (lg, body emphasis), 24px (xl), 28px (2xl, the one thing on screen) |
| Display (character face) | `"Caprasimo", ui-serif, Georgia, "Times New Roman", "Noto Serif", serif` | The one identifier on a row (family head name), EmptyState/ErrorState titles, SectionHead titles, page headings. Single weight (400), characterful |
| Mono (all figures) | `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` | Every number in tabular form: PAX, room numbers, times, counts, balances — always with `tabular-nums` |

Type rules:
- Section eyebrows are **small caps** (`text-xs`, `font-semibold`,
  `tracking-[0.14em]`, uppercase, muted) over a hairline underline.
- 16px base is a hard floor for body and all form controls.
- Focus-visible is a 2px outline with 2px offset, everywhere (terracotta
  brand in the design system; the app keeps the ink ring for AA).
- `::selection` is a terracotta tint.

## 4. Spacing, radius, shape, motion

- **Spacing**: 4px base scale — 4, 8, 12, 16, 24, 32, 48px. Screens use a
  16px horizontal gutter (`px-4`) inside the 480px max-width column.
- **Radii — the Organic shape language**:
  - `rounded-full` (999px) — **pills**: buttons, inputs, selects, chips,
    segmented controls, status pills, tags. The defining shape.
  - `rounded-2xl` (`~1.1rem`) — soft cards and containers.
  - `rounded-lg` (14px) — nested row chips and small fills.
  - No sharp corners. No hairline-only geometry — warmth is the point.
- **Cards** sit on the paper with a `surface` background, `rule-strong` hairline
  border, and a soft `shadow-sm` elevation — they read as lifted, not floating.
- **Buttons**: primary = solid ink fill with paper text (`bg-ink text-paper`),
  pill-shaped, active dims to 85%; secondary = surface fill, strong-rule
  border, ink text; danger = solid ledger-red with paper text; ghost =
  transparent, ink text. Selected chips/tabs/outcomes = **solid terracotta
  brand** with `brand-fg`. Minimum heights: `md` 44px, `lg` 56px. Never below
  44px — thumbs, gloves, rain.
- **Motion**: one ease family `cubic-bezier(0.23, 1, 0.32, 1)`; press states
  100ms colour shifts; list entrance is a 150ms opacity fade. **Nothing else
  animates.** All motion collapses under `prefers-reduced-motion`.
- **Safe areas**: `pt-safe/pb-safe/px-safe` utilities; bottom bars use
  `pb-safe` and content clears the fixed nav with `pb-nav`.

## 5. Component inventory

### Core primitives (`src/components/ui/`)
- **Card** — rounded-2xl surface container, hairline border, optional `flat`
  (borderless). Parts: CardHeader (bottom hairline), CardBody, CardFooter (top
  hairline), CardTitle.
- **Button** — variants primary/secondary/danger/ghost; sizes md (44px)/lg
  (56px); loading spinner swap; full-width option. Button look also available
  as `LinkButton` (same class list, rendered as an anchor) so navigation
  targets look identical.
- **ListRow** — the ledger row: alternating paper bands, identifier on the
  left in **display serif at 18px**, meta line under it (secondary facts,
  never numbers in the meta), and at most **one StatusPill** on the right.
  Whole-row press renders a `<button>` with a 100ms pressed band. Rows are
  min-h 56px. The red margin rule lives on the list container, not the rows.
- **StatusPill** — the **only** component that renders a status colour.
  Rounded-md bordered chip, always carries its label as text (colour-blind
  coordinators read the words). Four tones: `neutral` (paper fill, strong-rule
  border, muted text), `active` (solid ink fill, paper text — "in hand" reads
  like an ink stamp), `attention` (red-tint fill, ledger-red text), `done`
  (green-tint fill, ledger-green text). Sizes sm/md.
- **Badge** — rounded-full tinted chip, tones neutral/success/warning/
  danger/info; used for counts, vehicle status, room occupancy fractions.
- **StatCard** — dashboard counter: label (muted, sm) + icon in a rounded-lg
  tinted square + the number in **text-4xl bold tabular-nums**, tone colours
  the number and the icon tile; optional note line. min-h 112px, read-only.
- **FieldRow** — labelled ledger line: muted label left, value right in mono
  tabular-nums; a null value reads **"Not yet confirmed"** (never a blank or a
  dash); `attention` renders the value in ledger red (an unbalanced figure).
- **SectionHead** — small-caps eyebrow + optional title over a hairline rule.
- **Input / Select / Textarea** — label/hint/error shell (`Field`), native
  controls (the OS picker is the only one-handed picker), 16px text minimum,
  min-h 48px controls, error state = ledger-red border + red alert message
  (aria-invalid + aria-describedby wired). Select draws a chevron.
- **EmptyState** — a ruled-paper leaf: **dashed** strong-rule border, centered,
  icon in a paper-band circle, display-serif title, one action. Says which
  filter hides the rows and offers one tap to clear it.
- **ErrorState** — red-tint border + fill, red-tint icon circle, display-serif
  red title, plain-words description, one-tap Retry (secondary). Never a bare
  error code; always a next step.
- **LoadingRows** — skeletons shaped exactly like ListRow (banded, same
  min-h), never a spinner for a known layout; 150ms fade.
- **PageLoading** — spinner + label, `min-h-[50vh]`.
- **Spinner** — ring spinner in currentColor.
- **SyncChip** — "3 waiting to upload · call outcomes" — the offline queue
  surfaced without ceremony; only renders when count > 0; tap to see the list.
- **StickyHeader** — every screen's top bar: sticky, `surface/95` with subtle
  backdrop blur, hairline bottom border, safe-area padded. 44px back chevron,
  truncating title (18px semibold), subtitle, right actions. Optional second
  row for filters/search. Max width 480px.
- **ActionBar** — fixed bottom action area: paper background (no floating
  chrome), hairline top border, safe-area aware, max-width 480px. One primary
  action in the thumb zone; the primary lifts off the paper by being the only
  filled ink element in the lower third.

### Navigation (`src/components/nav/`)
- **BottomTabs** — fixed bottom nav, thumb-reach, border-t hairline on
  surface, max-width 480px grid (1–8 columns by role). Each tab: icon (24px)
  over a 12px label, min-h 64px, active = brand (indigo) + aria-current.
  Role-scoped lists: admin sees Queue, Import, Review, Rooms, Fleet, Trips,
  Depart, Home; event_team sees all but Import; **client gets no bar at all**
  (they have exactly one screen).
- **EventSwitcher** — transparent native `<select>` laid over a chip with
  switch + chevron icons; 44px target; jumps between events.
- **AdminLink** — the only door to /admin/events: a small rounded-xl icon
  button with a sliders icon, muted.

### Dashboard (`src/components/dashboard/`)
- **StatCard** — see above. Dashboard screens lay these in a **2-column grid**
  grouped under small section headings (RSVP / Today / Rooms / Deliveries /
  Money).

## 6. Status vocabulary (single source of truth)

Every status has one fixed wording and one fixed tone — identical words on
every screen. **Red = attention only; green = completed only.**

| Vocabulary | Values (label → tone) |
|---|---|
| RSVP / calling | Not started → neutral · Attempted → neutral · Callback → neutral · Tentative → neutral · **Confirmed → done (green)** · Declined → attention · Unreachable → attention |
| Delivery (hampers) | Pending → neutral · Assigned → active (ink) · **Delivered → done** · Not required → neutral |
| Ledger (arrival/departure balance) | **Balanced → done** · Departure missing → attention · No arrival → attention |
| Rooms | Empty → neutral · Partly full → neutral · Full → neutral · **Over capacity → attention** |
| Fleet (vehicle) | Available → success/green-ish chip · Assigned → warning · Unavailable → neutral |
| Call outcomes | Confirmed · Callback · Tentative · Declined · Unreachable · No answer · Busy · Other (+ "No call happened" closes as Other with an explanatory note) |

## 7. Screen catalog

Layout shell for staff screens: StickyHeader (event name + date range/venue
subtitle, EventSwitcher, AdminLink, sign out) → 480px column, 16px gutter,
zebra-banded lists with the red margin rule → fixed BottomTabs. All pages
fade in 150ms.

### 7.1 Login (`/login`)
Centered on warm paper, max-w-md card. Big "Nuvent" wordmark (28px bold),
"Sign in to your event." muted subline, notice box (warning tint) for expired
magic-link messages, a Card containing the login form (fields + primary
button), and a footnote: "Accounts are created by an event admin… there is no
self sign-up."

### 7.2 Staff dashboard (`/{code}`)
"Today at a glance". 2-column grid of StatCards: Total groups, Total pax,
RSVP confirmed (green), RSVP pending (amber), Arrivals today (info),
Departures today (info), Hampers delivered (green), Hampers pending (amber).
Footnote: "Counters are read live… a zero means nothing recorded yet." Also
renders an optional denied-notice card when a role was bounced from a
restricted screen.

### 7.3 Calling Queue (`/{code}/queue`)
The heart of the app. SectionHead "Calling queue / Families to call", then a
filter row (status chips, side, callbacks booked, hide locked — URL-driven,
pill-styled like the ledger's filter chips), then the **banded list with the
continuous red margin rule**. Each QueueRow: family head name in display serif,
meta line (PAX mono count, attempt count, "Locked" when claimed), one StatusPill
(RSVP tone). Empty states: "No families match these filters" (clear-filters
action) or "Nothing to call yet" (admin gets "Go to import" CTA). Realtime
updates from Supabase; skeletons while loading; live error state with the last
good list preserved.

### 7.4 Call screen (`/{code}/call/{groupId}`)
BackRow (name + mobile + city, lock countdown pill that shifts neutral →
amber → red as the 15-min claim expires). Cards: **Group context** (name,
RSVP pill, side/city/mobiles/priority FieldRows, remarks box) → **Travel**
(arrival/departure legs with down/up arrow icons) → **Call action**: big
"Call {label}" primary button (lg, 56px) + "Call alternate" secondary that
launch the OS dialer, then **OutcomeCard** — 2-column grid of outcome tiles
(selected tile = solid brand fill), callback datetime input, notes textarea,
"Save outcome" primary + "Dial again" secondary + "No call happened" ghost.
Confirm-before-save card (records freeze on save). **Submitted card**: green
check "Outcome saved" or amber clock "Saved on this phone" (offline queue) +
"Release family & back to queue". **Previous attempts** list with outcome
badges, duration, notes, callback reminders. A dashed placeholder card for
future call recording. SyncChip/queued-count footnotes when offline writes are
waiting.

### 7.5 Import wizard (`/{code}/import`)
Two steps, no third: **Upload** (file picker, event-start-date guard) →
**Preview**. SummaryBar leads with the "Needs a human" band (Orphan rows →
red if any, No phone number → amber if any, blocked-families alert), then
"What the file contains" (families, guests, not started/tentative/declined,
no arrival date, blank rows skipped) as tinted stat tiles in 2–3 column grids.
PreviewStep shows the parsed families as banded rows; WarningsList lists
per-row issues; layout mismatch stops and names the missing Excel headers
(never a guessed preview). Nothing is written until the operator confirms.

### 7.6 Review (`/{code}/review/{extractionId}`)
Review an AI-extracted call detail: a form prefilled from the transcript with
**per-field confidence chips** (amber shield + % when below threshold, neutral
% otherwise), "Low confidence — check this against the transcript" inline
notes, invalid-number and clear-attempt warnings in red, and Accept/Reject
actions. Uses the standard Input/Select/Textarea set.

### 7.7 Rooms (`/{code}/rooms`)
"Tap a guest, then tap a room. Two taps to move." Unplaced-guests chip row
(selectable, selected = brand fill), then a stack of **room cards**: hotel ·
room number, occupancy badge `occupants/capacity · N free` (or red "· OVER"),
occupant rows with head-of-family badges, per-guest "Release". Over-capacity
add requires a **reason** (the audit trail) — red-tint warning card with
"Add anyway" (danger) / "Cancel". Release also demands a reason. Empty state:
"No rooms set up".

### 7.8 Fleet (`/{code}/fleet`)
Header with count + Add toggle. **Quick-add panel**: per vehicle-type rows
(capacity with luggage, seat label) with a 0–10 count `<select>` and Add
button, plus a Custom row. Vehicle cards: label, status Badge (Available →
green, Assigned → amber, Unavailable → neutral), capacity figure, driver/
vendor/registration detail lines, "Remove" ghost action. Empty: "No vehicles
yet".

### 7.9 Trips / Logistics (`/{code}/logistics`)
"Review the proposal, then commit. Nothing is written until you commit."
Pill-style **Arrivals / Departures tab** switch (active = brand fill). Summary
strip (N trips · N seats used · N unplaced in red), then **trip cards**:
vehicle label, seats-used badge, driver, pickup point · scheduled time, and
group rows (head name, PAX, travel time) as surface-2 fills. A "Could not
place" red card lists unplaceable legs with reasons. Primary "Commit plan"
button; after commit, a secondary "Back to fleet" link.

### 7.10 Departures (`/{code}/departures`)
Walk-up departure recording. Search bar ("Search by name or room number") →
results list (head name, room · hotel, PAX, source note) → **departure form**
card: date/time pair, mode select (Air/Train/Bus/Cab/Self drive), reference,
drop point, PAX, and a **cab-expense panel** (surface-2, amber border) with
amount (₹), payment mode (Cash/UPI/Vendor bill), notes. "Save departure"
primary + ghost Cancel; existing-leg notice warns "the newer human entry
wins"; saved state offers "Arrange a vehicle" link to Trips.

### 7.11 Client guest list (`/{code}/guests`)
The **only** screen a client role sees — read-only, no tab bar. Heading with
guest/family counts, then **FamilySection** cards grouped by family head: each
GuestCard lists the guest, their room, arrival/departure legs, times — with a
blank line meaning "not shared yet", never "nothing planned". Footnote explains
data appears as the team records it.

### 7.12 Admin — Events (`/admin/events`)
Event list: Cards with event name (18px semibold), couple line, code Badge +
"Active"/"Inactive"/"No dates" warning badges + date range, chevron affordance,
tapping opens the event. Then "Create an event": a long form (name, code with
live uppercase-preview hint, bride, groom, first day, last day) with the
primary "Create event" button; server-side validation errors render as red
alerts and per-field red messages. Empty state: "No events yet".

### 7.13 Admin — Event dashboard (`/admin/events/{code}`)
Same StatCard language as staff dashboard plus: **Today's movements** panel
(arrivals with down-arrow info icon, departures with up-arrow warning icon;
each leg row = mono time · name · mode/reference/point · PAX badge · vehicle
check), and **Needs attention** panel — full-width secondary buttons, one per
live gap, each with a labelled count chip: "Confirmed · no room" (danger),
"Arriving today · no vehicle" (danger), "No departure recorded" (warning),
"Hampers pending" (warning), each linking to the fix screen. Hidden entirely
when everything is at zero.

### 7.14 Admin — Travel ledger (`/admin/events/{code}/ledger`)
Big headline card: **"N of M"** in 30px bold tabular — families balanced, with
"N still here" in red when unbalanced > 0. Filter chips All / Missing
departure / No arrival. Rows as full-width secondary buttons: family name +
PAX badge left, status Badge right (Balanced green / Departure missing red /
No arrival amber). "Export to Excel" secondary button with download icon
(writes an .xlsx of the ledger).

### 7.15 Admin — Messages (`/admin/events/{code}/messages`)
Broadcast hub: template list (TemplatesClient), send flow (SendClient /
ManualSendClient), and a log of sent messages (LogClient). Uses the standard
form and card vocabulary; compose in a Card with a template picker, message
body textarea, audience summary, and a primary "Send" with confirm.

## 8. Stitch generation guidance

- **Platform**: mobile-first phone UI, 360–480px, Android-first, light + dark.
- **One continuous system**: reuse the same Card, StatCard, ListRow, StatusPill,
  Button and StickyHeader shapes on every screen — no per-screen invention.
- **Color discipline**: generate using the exact hex tokens in §2. Never add a
  fourth "brand" color; never use red or green decoratively.
- **Figures line up**: every count, PAX, room number, time and balance in mono
  with tabular numerals, right-aligned in columns where a column exists.
- **Statuses always carry words**, never colour alone.
- **Do not invent charts.** This app has no line charts, bar charts, or graphs —
  it is a ledger. Numbers are counts and tabular figures, not visualizations.
- **Interactions to show**: pressed/hover states (100ms colour shifts),
  selected filter chips and outcome tiles (brand fill), loading skeletons that
  mirror the final rows, offline sync chip, error states with retry, empty
  states that invite one action.
- **Accessibility baked in**: 16px floor on body/controls, 44px minimum touch
  targets, WCAG AA contrast, focus rings, safe-area insets.
