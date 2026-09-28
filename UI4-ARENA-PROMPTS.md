# EventFlow — UI4 "Haldi & Ink": new structure (flows + navigation) and redesign — arena prompts + Claude Code prompts

> **Build status (28 Sep 2026) — built directly, without arena, at the owner's request.**
> DECISIONS.md has one entry per step. Done: Control tab + screen (C5, CS3 bars), section
> switcher, admin inside the one shell with `AdminMobileNav` deleted (C4), Haldi & Ink tokens and
> fonts (C1), the 60fps rules as a test with every offender fixed (C2), draggable sheets, event
> pill with same-tab switching (N9), Android back order (CS4/N4), button press, family page
> (CS5), setup checklist (CS8), hero guests card on Today, design-system page as the living spec.
> **Not done:** the route moves and redirects of S3 beyond `/families` (CS1/CS7), the merged
> single-URL call flow (CS6), the per-screen restyles C6–C14 beyond what the tokens give, and the
> frame measurements (C15/CS9). **Nothing has been run on a handset.**

**Supersedes the visual layer of `UI2-PROMPTS.md` (V0–V12) and the v3 shell.** It does NOT
supersede their rules. `docs/UX-RULES.md` (R1–R8) and `docs/INTERACTION-CONTRACT.md` (T1–T7)
still apply to every screen below. This series adds an eighth concern those two never had:
**frame rate.**

Two kinds of prompt live in this file, and they go to two different places:

| Part | Goes to | Sees the repo? | Produces |
|---|---|---|---|
| **Part S** | You, first | — | **The new structure**: who lands where, the tab bars, the route map, the family page, every job's flow with tap counts, navigation rules N1–N10. The A and C prompts are built on it. |
| **AF-series** (AF1–AF6) | **arena.ai** | **No.** | Clickable multi-screen *flow* prototypes, to prove the structure before any screen is polished. |
| **A-series** (A0–A16) | **arena.ai** (WebDev arena, two models side by side) | **No.** Every prompt must carry its own context. | A single-file React prototype per screen, with mock data. You pick the winner. |
| **CS-series** (CS0–CS9) | **Claude Code / Command Code** in `C:\dev\EventFlow` | Yes | The structure, built: route map + redirects, landings, back button, family page, merged flows. |
| **C-series** (C0–C15) | **Claude Code / Command Code** in `C:\dev\EventFlow` | Yes | The winning prototype, ported into the real app on real data, behind the rules. |

One A prompt → pick a winner → save it → run the matching C prompt → commit → handset.
Never run a C prompt without its A winner saved in `design/arena/`.

**Scope of "structure" in this file: flows and navigation only.** The route groups
(`(staff)`, `(app)/v2`, `(admin)`), the folder layout, the data layer, the database and the
APK shell are NOT restructured here. New URLs are new thin pages in the existing groups that
reuse existing components; old URLs redirect. That keeps every session revertible.

**Free-rebuild conditions:** the 26 Aug 2026 event is done. No staff are on handsets. These
prompts may replace the shell, the nav and every screen's look. They still must not write
migrations, must not rename any frozen identifier (CLAUDE.md §12), and must not touch the
native recorder — **call-recording debugging is the NEXT series, not this one** (see the end
of this file).

---

## 0. A note on references (Mobbin)

The Mobbin MCP was tried while writing this file and returned *"requires a paid plan"* on
every call, so no Mobbin screens are cited as fetched. The references below are named apps
whose patterns are well known; search them on Mobbin yourself before each A prompt if you
have access — the query strings are given so you can paste them.

| Pattern we want | Look at | Mobbin query to paste |
|---|---|---|
| One big number, then "what needs you" | Revolut home, Oura today, Linear mobile inbox | `home dashboard with one large headline number and a list of items needing attention` |
| Workspace / event switcher as a header pill + sheet | Slack workspace switcher, Notion, Linear | `workspace switcher bottom sheet with current workspace checked` |
| Admin control centre that is a list, not a dashboard | iOS Settings, Airbnb host "Menu", Shopify mobile "Settings" | `settings list grouped into sections with icons and value on the right` |
| Command palette / search-everything | Linear ⌘K on mobile, Raycast, Things 3 quick find | `search screen with recent items and grouped results across categories` |
| A queue with one "current" card on top | Uber driver next trip, Tinder-style single card, Superhuman | `task queue with one large current card and the rest as a compact list` |
| In-call screen with clear state | iOS phone call screen, WhatsApp call, Otter live recording | `active phone call screen with recording indicator and timer` |
| Outcome tiles, one tap | Duolingo answer tiles, Airbnb review stars, Headspace mood picker | `choose one option from large tappable tiles then save` |
| Room / seat board | Airbnb multi-calendar, BookMyShow seat map, Cron | `grid of rooms or seats with occupancy colour and a filter sheet` |
| Camera proof + "sealed" moment | Uber Eats proof of delivery, Cash App payment sent, Apple Pay done | `photo proof of delivery capture then confirmation stamp` |
| Wizard with progress | Monzo account setup, Luma create event, Partiful create | `create event multi-step form with progress indicator` |

---

## 1. What is actually wrong with admin on a phone — verified in the tree today

The complaint is "admin access in mobile is worse". It is, and for structural reasons, not
cosmetic ones. Every row was checked against the code on `37347b3`.

| Evidence | Where | What it does to an admin holding a phone |
|---|---|---|
| **Admin is a second app** | `src/app/(admin)/layout.tsx` renders its own `ScreenHeader title="Admin"` with `backHref="/"` and `backLabel="App"` | The admin leaves "the App" to do admin work, and leaves "Admin" to see the event. Two headers, two tab bars, two mental models for one person. |
| **Four tabs, one of them a junk drawer** | `src/app/(admin)/AdminMobileNav.tsx` — Events · Dashboard · **Msgs** · More | Five of the seven event pages (Hotels, Access codes, Ledger, Files, Settings) live behind **More**. The most-used admin jobs — codes and staff — are two taps and a sheet away. "Msgs" is an abbreviation (R2). |
| **The event switcher is hidden in More** | `AdminMobileNav.tsx` — `EventSwitcher` only inside the `BottomSheet` | The layout's own comment says editing the wrong wedding is "the single most dangerous mistake on this panel". On a phone the current event is not on screen and switching it is three taps deep. |
| **A developer tool is in the admin's main nav** | `AdminMobileNav.tsx` → `SheetLink href="/admin/harvest-debug"` on every sheet | "Harvest debug" sits next to Settings for a non-technical organiser. |
| **The dashboard is a stack, not a view** | `admin/events/[eventCode]/page.tsx` — amber staff warning, `DashboardClient`, a two-row `Card` (Staff, Hotels), `ArchiveEventCard` | No answer to "what needs me right now". Staff and Hotels are links on the dashboard *and* in More; Codes is only in More. |
| **Staff tabs and admin tabs never meet** | `src/lib/sections/v3.ts` (Today · Calls · Hospitality · Hampers · Logistics) vs `src/lib/admin/nav.tsx` `EVENT_NAV` | An admin who is also calling families on the day has no route from a call to the access-code screen without a full shell swap. |
| **Desktop got the good version** | `AdminSidebar.tsx` is `hidden md:flex` and lists everything flat | Everything that is one click on a laptop is a sheet on a phone. The phone is where the admin actually is on event day. |

**The conclusion:** do not reskin the admin shell. **Delete the idea of a separate admin
shell on phones.** Admin is a *role inside the one app*, with one extra tab (**Control**) and
the event pill always visible. Desktop (`md:`) keeps its sidebar.

---

## 2. The new design language — "Haldi & Ink"

This is **completely different** from the maroon-and-Bricolage v3 skin and from the earlier
Royal Ivory & Gold. It is still a **light app** — R7 (daylight legibility) and the native
launch chain (`colors.xml`, splash, status bar) are all light, and a dark ground would bring
back the one-frame dark flash `colors.xml` documents. What changes is everything the eye
lands on.

**The idea in one line:** a bone-white ledger, ink-black type set big, one electric indigo for
"act here", and haldi (turmeric) marigold for "happening now". Indian-wedding warm without a
single paisley. Editorial numbers, quiet chrome.

### 2.1 Colour tokens (names are the EXISTING `--ef-*` names — only values change)

Keeping the token names is what makes the port cheap: every component already reads them.

| Token | Value | Role | Contrast (WCAG formula, computed) |
|---|---|---|---|
| `--ef-paper` | `#F4F1EA` | Bone. The ground. | — |
| `--ef-paper-band` | `#EDE8DD` | Zebra band, pressed row | — |
| `--ef-surface` | `#FFFFFF` | Cards, sheets, inputs | — |
| `--ef-surface-2` | `#EFEBE2` | Nested fill, segmented track | — |
| `--ef-ink` | `#141311` | All primary text, icons | 16.5:1 on paper |
| `--ef-muted` | `#5C574E` | Secondary text | 6.4:1 on paper |
| `--ef-subtle` | `#6E685C` | Tertiary, placeholders | 4.9:1 on paper |
| `--ef-rule` | `#E3DDD0` | Hairlines | — |
| `--ef-rule-strong` | `#D2CAB8` | Field borders | — |
| `--ef-brand` | `#2F2BD8` | **Neel (indigo). The action colour.** Primary button fill, active tab, selected chip, focus ring, links. | 7.6:1 on paper; white on it 8.5:1 |
| `--ef-brand-hover` | `#2320B0` | Pressed primary | — |
| `--ef-brand-fg` | `#FFFFFF` | Text on indigo | — |
| `--ef-brand-tint` | `#E6E5FB` | Selected row, active tab pill | — |
| `--ef-highlight` | `#F5B301` | **Haldi (marigold). "Now / in hand".** FILL ONLY, always with ink text on it. Never marigold text on a light ground. | ink on it 10.0:1 |
| `--ef-highlight-fg` | `#141311` | Text on marigold | — |
| `--ef-highlight-tint` | `#F5B30133` | In-progress wash | — |
| `--ef-now` | `#141311` | The one dark surface: the **Now card** (current family, live call, today's headline) | — |
| `--ef-now-fg` | `#F4F1EA` | Text on Now | 16.5:1 |
| `--ef-now-muted` | `#A8A294` | Secondary on Now | 7.3:1 |
| `--ef-ledger-green` | `#16794A` | COMPLETED only: confirmed, delivered, checked in, balanced | 4.8:1 on paper |
| `--ef-green-tint` | `#E1F1E8` | Green pill fill | — |
| `--ef-ledger-red` | `#C62A1E` | ATTENTION only: overdue, over capacity, failed, destructive | 5.0:1 on paper |
| `--ef-red-tint` | `#FBE7E4` | Red pill fill | — |
| `--ef-ledger-amber` | `#8A5A00` | Waiting / maybe / callback (text) | 5.3:1 on paper |
| `--ef-amber-tint` | `#FBF0D6` | Amber pill fill | — |
| `--ef-nav` | `#FFFFFF` | Tab bar surface | — |

**Colour rules (checkable):**
1. Indigo = "tap here / you are here". Nothing decorative is indigo.
2. Marigold = "happening now". At most **one** marigold element per screen.
3. Green and red keep their absolute ledger meanings. "Not coming" is NOT red — it is ink
   with a strike-through pill; declining is an answer, not a problem.
4. The Now card is the only dark surface. At most one per screen.
5. The family (client) theme `[data-theme='client']` keeps its own warmer paper
   (`#FBF7F0`) and the same indigo — do not invent a second accent for it.

### 2.2 Type

| Role | Font (via `next/font/google`) | Use |
|---|---|---|
| Display | **Instrument Serif** 400 + italic | Screen titles (32px), the one hero number (56–72px), empty-state titles. The italic is reserved for the hero number's unit ("*guests*"). |
| UI | **Geist** 400 / 500 / 600 | Everything else. 16px base, never below for body or inputs. |
| Figures | **Geist Mono** 500, `tabular-nums` | Every column of numbers: PAX, rooms, times, counts, codes. |
| Indic | **IBM Plex Sans Devanagari** (already loaded) — plus **Noto Sans Gujarati** | Family names typed in Gujarati/Hindi must not fall back to a tofu box. |

Max three Latin families. Scale: 12 / 14 / 16 / 20 / 24 / 32 / 56 / 72.
Eyebrow: 12px Geist 600, `letter-spacing: 0.08em`, uppercase, muted.

### 2.3 Shape, space, elevation

- Radii: controls **14px**, cards **24px**, sheets **32px** (top corners), pills **999px**.
- Spacing: 4px base; screen gutter 20px; section gap 32px; row min-height 64px.
- Tap targets ≥ 48px (above R7's 44 — the new rows are bigger, not smaller).
- Elevation: keep the existing `--ef-shadow-e1/e2/e3` names, ink-tinted, ≤ 6% opacity.
  Cards on bone mostly need **no** shadow — a 1px `--ef-rule` border and white fill is enough.
- Icons: 1.75px stroke, 24px box, rounded caps. Map to `src/components/icons.tsx`.

### 2.4 Motion — confirmation, never decoration

| Token | Value | Used for |
|---|---|---|
| `--ef-duration-press` | 90ms | Press feedback (scale 0.97 + tint) |
| `--ef-duration-fade` | 160ms | Content arriving into a laid-out frame |
| `--ef-duration-enter` | 240ms | Sheet / detail enter |
| `--ef-ease` | `cubic-bezier(0.16, 1, 0.3, 1)` | Everything that eases |
| Spring (sheets, drag) | `stiffness 420, damping 40, mass 1` | Bottom sheets, swipe rows, drag-to-dismiss |

Signature moments (each happens once, on a real event, never on navigation):
- **The seal** — delivery proof committed: stamp scales 1.2→1 with the green tint.
- **The tick** — RSVP outcome saved: the outcome tile morphs into a check (opacity + scale).
- **The count** — hero number on Today counts up once per cold start, not per tab visit.

---

## 3. The 60 fps contract (F1–F10)

"60 fps" on a ₹8,000 Android in a Capacitor WebView is a budget of **16.7ms per frame on a
slow core**. The rules below are what make that true. They are pass/fail, and C2 turns them
into tests.

| # | Rule | Pass condition |
|---|---|---|
| F1 | **Animate `transform` and `opacity` only.** | No `motion` animate/transition target, CSS `transition`, or `@keyframes` touches `width`, `height`, `top`, `left`, `margin`, `padding`, `box-shadow`, `filter` or `background-position`. |
| F2 | **No `backdrop-filter` anywhere.** Blur is the single most expensive thing a cheap GPU does, and a sticky blurred header re-blurs on every scroll frame. | `backdrop-blur` / `backdrop-filter` appears zero times under `src/`. Sticky headers are solid `--ef-paper` with a 1px rule that fades in via opacity. |
| F3 | **Elevation never animates.** | Hover/press never changes `box-shadow`; if a lift is wanted, animate the opacity of a pre-rendered shadow pseudo-element. |
| F4 | **Long lists are cheap.** 238 families / 465 guests is the floor. | Any list that can exceed 40 rows uses `content-visibility: auto` + `contain-intrinsic-size` on rows, renders no `m.*` component per row, and has no per-row entrance animation. |
| F5 | **Entrances run once.** | A stagger may animate at most the first 8 items, only on first mount of a route, never on tab return (the `pointer: coarse` kill-block in `globals.css` stays as the safety net). |
| F6 | **Scroll is never JS.** | No `scroll`/`touchmove` listener calls `setState`. Scroll-linked effects use `position: sticky` or CSS scroll-driven animations with a static fallback. All listeners `{ passive: true }`. |
| F7 | **No layout reads in loops.** | No `getBoundingClientRect` / `offsetHeight` inside render, `map`, or rAF loops. |
| F8 | **Heavy work leaves the tap path.** | SheetJS (`xlsx`) and any parser are `import()`ed lazily; no handler blocks the main thread > 50ms (checked with `long-animation-frame` entries). |
| F9 | **Sheets are real native-feeling sheets.** | Drag-to-dismiss via `m.div` `drag="y"` with the spring above, `overscroll-behavior: contain` on the sheet body, `touch-action: pan-y`. No sheet re-renders its parent list while dragging. |
| F10 | **Measured, not claimed.** | The Playwright `feel` project, with CDP CPU throttling ×4, records zero long animation frames > 50ms across: tab switch, open/close sheet, scroll 240-row list, save RSVP. On a real handset, Chrome remote DevTools → Performance shows no red frames on the same four gestures. |

Plus the three that are really UX but read as "lag" (already law in T1–T7, repeated because
they matter more than any animation): **optimistic writes (T2), no spinner-disabled buttons
(T3), prefetch + cached frames on navigation (T4).** A 60 fps animation in front of a 4-second
server wait still feels slow.

---

## 4. The new information architecture — one app, role-shaped

*This is the summary. The full structure — every role, route, flow and navigation rule — is
**Part S** below, and Part S wins where the two differ.*

```
                      ┌──────────────── header ────────────────┐
                      │  [SHARMA26 ▾]  event pill     (⌕) (you)│   ← always visible
                      └────────────────────────────────────────┘
 management / admin:   Today · Calls · Hospitality · Logistics · Control*
 runner (department):  only their section's screens (unchanged rules)
 client (family):      the family view, cream theme (unchanged rules)
                                          * Control appears only for admins
```

- **The event pill** (top-left, always) shows the event code + name, and opens the switcher
  sheet. For an admin it also lists "All events" and "New event". This is the fix for "editing
  the wrong wedding".
- **Search (⌕)** is one global "Find anything": families, guests, rooms, vehicles — and for an
  admin, admin tools ("codes", "rotate", "templates" jump straight to the tool).
- **Hampers** leaves the bar for management and becomes a segment inside Hospitality
  (Rooms · Check-in · Hampers). A hamper *runner* still gets Hampers as their whole app — the
  department rules in `src/lib/sections/v3.ts` do not change. This frees slot five for Control.
- **Control** (admin only) is a grouped list, iOS-Settings style — not a dashboard:
  - **People** — Staff (count) · Access codes (live count, last rotated)
  - **Guests** — Import sheet · Export · Files
  - **Venue** — Hotels & rooms (hotels · rooms)
  - **Messages** — Send · Templates · Log
  - **Money & records** — Ledger
  - **Event** — Section locks · Arrival alerts · Archive event (last, red, alone)
  - Developer tools (Harvest debug) move to `/debug`, reachable from the version row at the
    very bottom, not from the nav.
- `/admin/*` routes stay alive (desktop sidebar, deep links). On phones, the Control rows
  link to them rendered inside the ONE app shell.
- Plain words (R2): the tab is "Control", never "Admin", "Settings" or "Ops". "Msgs" dies.

---

# PART S — THE STRUCTURE (flows and navigation)

Read this before any A or C prompt. The look (Part A) is the skin; this is the skeleton.
A beautiful screen in the wrong place is still the wrong place, and every complaint about
admin-on-a-phone so far has been a *where* problem, not a *what it looks like* problem.

## S1. What is wrong with the structure today — verified in the tree

| Evidence | Where | What it does |
|---|---|---|
| **The event lead lands on Auto-call** | `src/lib/departments.ts` — `departmentHomePath('management')` returns `/{e}/rsvp/campaigns` | The person running the wedding opens the app to the auto-dialler campaign board, not to "how are we doing". |
| **A caller's first tab is Auto-call too** | `src/lib/sections/config.tsx` — rsvp children are `campaigns` (isDefault) · `queue` · `review`; a runner's bar is their section's children | The caller's actual job, the call list, is the second tab. |
| **One family, no page** | a family's facts are split across `rsvp/status/[groupId]`, `rsvp/call/[groupId]`, the guest-list card, the rooms board, the arrivals row and `hamper/[deliverableId]` | "Where is the Shah family, what room, did they land, did they get their hamper" is four screens and four searches. There is no URL that means *this family*. |
| **Calling one family is three routes** | `rsvp/queue` → `rsvp/call/[groupId]` → `rsvp/status/[groupId]`, plus `rsvp/next`, and `rsvp` itself only redirects to `rsvp/queue` | Every hop is a server render from Seoul (T4, T5), and the back button walks through all of them. |
| **Hampers live at two URLs** | `/{e}/hamper[/id]` and `/{e}/hospitality/deliveries[/id]`, both rendering `DeliveryDetail`; `config.tsx` needs "borrowed child" logic to hold it together | Two front doors to one job; R3 already had to be patched for the exits bouncing to `?denied=section`. |
| **Rooms are created in two places** | `admin/events/[e]/hotels/[hotelId]/rooms` and `hospitality/rooms/new/[hotelId]` | Two forms that can drift. |
| **Imports live in two shells** | `guests/import` (staff app) and `admin/events/[e]/import-hotels` (admin app) | Setting up an event means two apps. |
| **Admin is a second app** | §1 of this file | Two headers, two bars, a shell swap for every admin task. |
| **Android back is plain `history.back()`** | `src/components/native/NativeBridge.tsx` — `canGoBack ? history.back() : App.exitApp()` | Back does not close an open sheet first, walks backwards through every tab you hopped between, and exits the app outright from any screen opened by a deep link (no history). |
| **A new event has no setup path** | `CreateEventForm.tsx` → the admin dashboard | After creating an event, importing guests, adding staff, adding hotels and sharing codes are four separate places with nothing saying what is left. |
| **Guests left the bar with no directory to replace it** | `src/lib/sections/v3.ts` (Guests removed, "reached through search"); `find` is a search box, not a browsable list | A lead who wants "everyone not yet called from the bride's side" has no list to browse. |

## S2. Who lands where, and what bar they get

| Who | Lands on | Bottom bar | Header |
|---|---|---|---|
| **Organiser** (admin) | The event they last opened → **Today** (remembered on the device); no event yet → **All events** | Today · Calls · Hospitality · Logistics · **Control** | event pill · Find · You |
| **Event lead** (`management`) | **Today** | Today · Calls · Hospitality · Logistics | same |
| **Caller** (`rsvp`) | **Calls → Next** | Next · List · Review | same |
| **Hospitality runner** | **Rooms** | Rooms · Check-in · Rooming list | same |
| **Hamper runner** | **Hampers** (the next delivery) | none — one job, one screen | same |
| **Logistics runner** | **Arrivals** | Arrivals · Departures · Trips · Fleet | same |
| **Setup** (`production`, flag) | **Setup** | none | same |
| **No name picked** (skipped) | Today, with a one-line "Pick your name so your work is saved under it" row | as their department | same |
| **Family** (client) | **Family view** (read-only) | none | event name only, no Find |

Auto-call campaigns move to **Calls → List → "Auto-call"** for the lead only. Runners never
see it.

## S3. The route map — one URL per job

`/{e}` is the event code. "Replaces" means those URLs **redirect** (308) to the new one, so
old links, bookmarks and the arrival banner keep working. Nothing is deleted in this series.

| New URL | Replaces | What it is |
|---|---|---|
| `/{e}` | — | **Today** |
| `/{e}/families` | `/{e}/guests`, `/{e}/guests/list`, `/{e}/find` | Families directory: search on top, filter chips, A–Z list. Client role gets the read-only version here. |
| `/{e}/families/[groupId]` | *(new)* | **The family page** — see S4 |
| `/{e}/families/[groupId]/call` | `/{e}/rsvp/call/[groupId]`, `/{e}/rsvp/status/[groupId]` | The call flow: before → in call → outcome, one URL, three steps |
| `/{e}/calls` | `/{e}/rsvp`, `/{e}/rsvp/queue`, `/{e}/rsvp/next` | Next call card + the list with filters (`?show=callback` etc.) |
| `/{e}/calls/review` · `/[extractionId]` | `/{e}/rsvp/review[/…]`, `/{e}/rsvp/unmatched` → `?show=no-family` | Review what the AI heard |
| `/{e}/calls/auto` | `/{e}/rsvp/campaigns` | Auto-call (lead only) |
| `/{e}/hospitality` | — | Rooms board (default) |
| `/{e}/hospitality/checkin` · `/rooming-list` | — | unchanged |
| `/{e}/hampers` · `/[deliverableId]` | `/{e}/hamper[/…]`, `/{e}/hospitality/deliveries[/…]` | One hamper job, one URL |
| `/{e}/logistics/arrivals` · `/departures` · `/trips` · `/fleet` · `/sheets` | — | unchanged (`/{e}/logistics` → arrivals) |
| `/{e}/setup` | `/{e}/production` | The URL follows the word the screen already uses. The `production` department value in the database does NOT change. |
| `/{e}/control` | *(new)* | Admin tools, grouped (A3) |
| `/{e}/control/staff` · `/codes` · `/messages` · `/hotels` · `/import` · `/export` · `/files` · `/ledger` · `/settings` | on phones: `/admin/events/{e}/…`, `/{e}/guests/import`, `/{e}/guests/export`, `/admin/events/{e}/import-hotels`, `/{e}/hospitality/rooms/new[/…]` | The same screens, inside the one shell. `/admin/events/{e}/*` stays alive for the desktop sidebar. |
| `/events` | `/admin/events` on phones | All events + New event (admin) |
| `/me` | `/pick-staff` (as a sub-step) | You: switch person, sign out, app version (long-press → developer tools) |
| `/{e}/help` | — | unchanged |

## S4. The family page — the new centre of the app

Every search result, every "Needs you" row, every arrivals row and every room tile leads here.
It answers everything about one family on one screen, and its **one primary action changes
with where the family is in the event**:

| Family is… | Primary action |
|---|---|
| Not called / no answer | **Call** |
| Promised a call back | **Call back** (with the promised time) |
| Coming, arriving today, not checked in | **Check in** |
| Checked in, hamper not delivered | **Deliver hamper** |
| Checked in, nothing pending | none — the page is a record |
| Not coming | none — "Change answer" as a quiet link |

Sections, top to bottom, each linking to its job screen: **Answer** (status, guests coming
/ expected, who logged it, when; lock holder if any) · **Travel** (arrival and departure legs,
car assigned) · **Stay** (hotel, room, beds, dates) · **Hamper** (status, proof photo) ·
**Calls** (every attempt, outcome, notes, recording/review link) · **People** (member names
once collected at room allocation) · **Notes** (remarks).

Rules: a section the viewer's department cannot see is not rendered (same predicates as
`config.tsx` — no new permission logic). The client sees Answer, Travel and Stay read-only.
The page uses only reads that already exist; if one join is missing, the prompt STOPS and
names it — no migrations in this series.

## S5. The jobs, end to end — taps before and after

"Before" is counted from the route structure on `37347b3` and is approximate; CS9 measures
both with `scripts/tap-budget.mjs`. A tap is any touch inside the app; typing is not counted.

| # | Job | Who | Before | After |
|---|---|---|---|---|
| 1 | Switch to another event | Organiser | More → switch control → pick (3), and the current event is not on screen | Event pill → pick (**2**), always visible |
| 2 | Rotate an access code | Organiser | App → Admin link → Dashboard → More → Access codes → Rotate → confirm (~6 + a shell swap) | Control → Access codes → Rotate → confirm (**4**) |
| 3 | Set up a new event | Organiser | Events → form → Create → then find Import (staff app), Staff, Hotels, Codes (admin app) separately | Pill → New event → 3 steps → lands on Today with a **setup checklist** (Import guests · Add staff · Add hotels · Share codes), each one tap, disappearing as each is done |
| 4 | Call the next family and log the answer | Caller | Queue → card → Call → *(dialler)* → status screen → outcome → Save → back to queue (~7) | Next → Call → *(dialler)* → outcome tile → Save, auto-advance (**4**) |
| 5 | Find a family and see everything | Lead | Search → status screen (RSVP only) + rooms search + arrivals search | Find → family (**2**, one screen) |
| 6 | Honour a promised call back | Caller / lead | Calls → Call back chip → family → … | Today "Needs you" row → Call (**2**) |
| 7 | Place an unplaced family in a room | Hospitality | Rooms → allocate → family → room | Rooms → Unplaced tray → family → room (**3**), Undo bar |
| 8 | Check in a family that just landed | Hospitality / lead | Arrivals (no link onward) → Hospitality → Check-in → search → Check in (~5) | Arrivals "Landed" row → family → Check in all (**3**); or Check-in, which lists "Arriving now" first (**2**) |
| 9 | Deliver a hamper with proof | Hamper runner | Hampers → item → photo → confirm (4) | same **4**, then auto-advance to the next delivery |
| 10 | A flight lands with no car | Lead / logistics | Arrivals → scan list → trips → … | Today "Needs you" → Assign → vehicle (**3**) |
| 11 | Import the guest list | Lead / organiser | Guests → Import (was invisible to event_team once — CLAUDE.md §12) | Control → Import (**2**), or the setup checklist |
| 12 | Send a WhatsApp update | Organiser | Admin → Msgs → Send → … | Control → Send a message (**2**) |
| 13 | The family checks today's arrivals | Client | lands on the guest list | lands on the family view with the Today card (**0**) |
| 14 | Start the day | Any staff | code → pick name → a department page | code → pick name → their landing (S2); next day the code is remembered, pick name only (**1**) |

## S6. Navigation rules N1–N10 (these become tests in CS9)

| # | Rule | Pass condition |
|---|---|---|
| N1 | **One shell.** Every signed-in phone screen has the same header (event pill · Find · You) and the role's bar. | No "Admin" header, no "App" back link, no second tab bar below `md`. |
| N2 | **Land by role** (S2). | A test per role asserts the landing URL. |
| N3 | **Tabs keep their place.** Switching tabs returns to that tab's last screen and scroll; tapping the active tab pops to its root, then to top. | Per-tab stack kept in `sessionStorage` (try/catch); verified by a unit test of the stack reducer. |
| N4 | **Android back, in order:** close the top sheet → back within the current tab's stack → the tab's root → the role's landing tab → "Press back again to close EventFlow" (2s) → exit. | Pure function `resolveBack(state)` with a unit test per step; never exits from a deep screen; never walks back through tab switches. |
| N5 | **Back is named and deterministic** (R3). A detail screen's back goes to the tab root it belongs to, even when opened by a deep link. | Every detail page declares its parent URL; no `router.back()` in page code. |
| N6 | **Pages vs sheets.** Anything with an identity (a family, a room, a hamper, a trip) is a page with a URL. Sheets are for choosing and short edits. | No family/room/hamper detail exists only as a sheet. |
| N7 | **Every number is a door** (R4), to a URL with the filter in it (`?show=callback`), so the filter survives back and reload. | Filters are read from the query string, not component state. |
| N8 | **Deep links land in context.** Banner, "Needs you" rows and search results open the family page with the relevant section expanded (`#travel`, `#stay`, `#hamper`). | Anchors exist and scroll into view on load. |
| N9 | **The event is never ambiguous.** Switching event keeps you on the same tab in the new event (or Today if your role cannot see it). A URL for an event you cannot access shows the denied screen with "Switch event". | Test: switch from Calls in A → Calls in B. |
| N10 | **One place per job.** No job is reachable at two URLs with different chrome; every replaced URL in S3 redirects. | `src/lib/nav/route-map.ts` is the single table, and a test walks it. |

---

# PART A — ARENA PROMPTS (paste into arena.ai)

## A-BRIEF — paste this at the top of EVERY A prompt

Arena models have never seen this repo. This brief is their entire world. Paste it verbatim,
then the screen prompt under it.

```
You are designing ONE screen of EventFlow, a mobile app that runs the guest operations of a
large Indian wedding: ~240 families, ~470 guests, 10–20 staff. Staff call families to confirm
who is coming, allocate hotel rooms, arrange airport pickups, deliver hampers with photo
proof, and check guests in. The organiser (admin) runs the whole event from the same phone.
Users are non-technical, get no training, and work one-handed in hotel corridors on cheap
Android phones (360–412px wide, slow CPU) over bad venue Wi-Fi. The bar for design quality is
an Awwwards "App of the Day" — but it must hold 60fps on a ₹8,000 phone.

OUTPUT FORMAT — follow exactly:
- ONE file, App.tsx: React 19 + TypeScript + Tailwind CSS utility classes.
- Allowed imports ONLY: react, motion/react (framer-motion API), lucide-react. Nothing else.
- Put the design tokens below as CSS variables in a <style> tag at the top of the component
  tree, and use them through Tailwind arbitrary values like bg-[var(--paper)]. Do NOT hardcode
  any other hex anywhere.
- Render the screen inside a centred 390×844 phone frame (rounded 44px, 1px border) on a
  neutral page. Outside the frame, add a small toolbar that switches the screen between its
  states: Loaded · Empty · Loading · Error · Offline · plus any state the screen prompt lists.
  Every state must be designed, not just Loaded.
- Realistic mock data, Indian and specific: families like "Shah Parivar — Rameshbhai Shah",
  "Desai family — Kokilaben Desai", cities Surat / Ahmedabad / Mumbai / Vadodara, flights like
  "6E 5074", hotel "JW Marriott Surat", event code SHARMA26 "Sharma–Patel Wedding, 18–21 Dec".
  Include at least one Gujarati name written in Gujarati script.
- All interactive elements must actually work in the prototype (tabs switch, sheets open and
  drag closed, chips filter, buttons change state).

DESIGN LANGUAGE "Haldi & Ink" — use exactly these tokens:
  --paper #F4F1EA  (ground)          --paper-band #EDE8DD  --surface #FFFFFF
  --surface-2 #EFEBE2               --ink #141311          --muted #5C574E
  --subtle #6E685C                   --rule #E3DDD0         --rule-strong #D2CAB8
  --brand #2F2BD8 (indigo: ACTION/SELECTED only)  --brand-hover #2320B0  --brand-tint #E6E5FB
  --haldi #F5B301 (marigold: NOW/IN HAND, fill only, always ink text on it, max 1 per screen)
  --now #141311 / --now-fg #F4F1EA / --now-muted #A8A294  (the ONE dark card per screen)
  --green #16794A / --green-tint #E1F1E8  (COMPLETED only)
  --red #C62A1E / --red-tint #FBE7E4      (ATTENTION only: overdue, failed, over capacity)
  --amber #8A5A00 / --amber-tint #FBF0D6  (waiting / maybe / call back)
Type: display "Instrument Serif" (titles 32px, one hero number 56–72px, italic only for the
hero's unit word); UI "Geist" 16px base, never smaller for body or inputs; every number in
"Geist Mono" with tabular-nums. Load them from Google Fonts in the <style> tag.
Shape: controls radius 14px, cards 24px, sheets 32px top corners, pills fully round.
Tap targets at least 48px. Screen gutter 20px. Light app — NO dark mode, NO dark ground.
"Not coming" is an answer, not an error: show it in ink, never red.

PERFORMANCE RULES — a design that breaks these is rejected, however good it looks:
- Animate ONLY transform and opacity. Never width/height/top/left/margin/box-shadow/filter.
- NO backdrop-filter / backdrop-blur anywhere. Sticky headers are solid.
- No animated shadows. No looping animations except a single 1.2s "recording" pulse dot.
- Press feedback: scale 0.97 + tint, 90ms. Easing cubic-bezier(0.16,1,0.3,1).
- Bottom sheets: motion drag="y" with a spring (stiffness 420, damping 40), drag-to-dismiss,
  overscroll-behavior: contain.
- Lists: no per-row animation beyond the first 8 rows on first mount; rows use
  content-visibility: auto.
- Page/tab changes are instant (no slide or fade between tabs). Only a detail screen may
  enter, 240ms, transform only.

UX RULES:
- One job per screen; the primary action is the biggest thing on it.
- Plain words a first-day runner understands. No jargon, no abbreviations ("Msgs" is banned;
  "PAX" becomes "guests").
- Every number is tappable and leads to the list it counts.
- Undo, don't confirm — except truly irreversible actions, which confirm once, plainly.
- Errors say what happened, what to do now, who to tell. Never a code.
- Offline is a state: every write shows "Saved", "Saved on this phone" or "Not saved".
- A tap shows a visible change within 100ms from local state; saves are optimistic.

Now design this screen:
```

---

## AF — FLOW PROTOTYPES (run these BEFORE A0)

These prove the structure in Part S before any screen is polished. Judge them on *where
things are and how you move*, not on looks — a plain winner that gets the flow right beats a
gorgeous one that doesn't. Paste **A-BRIEF**, then the **AF add-on** below, then one AF
prompt.

**AF add-on — paste after A-BRIEF in every AF prompt:**

```
THIS IS A FLOW PROTOTYPE, NOT A SINGLE SCREEN. Build several connected screens with real
navigation between them inside the one phone frame. Outside the frame, add:
- a ROLE switcher (the roles named in the prompt), which resets the prototype to that
  role's landing screen;
- an ANDROID BACK button that behaves exactly like this, in order: (1) if a sheet or dialog
  is open, close it; (2) else go back one step within the current tab; (3) else go to the
  current tab's first screen; (4) else go to the role's landing tab; (5) else show a toast
  "Press back again to close EventFlow" and, if pressed again within 2 seconds, show a
  "closed" screen. Back never walks through tab switches.
- a TAP COUNTER that counts every tap inside the frame since the flow started, with a reset
  button, and a small log of the screens visited in order.
Rules for navigation: every screen with an identity (a family, a room, a hamper, a trip)
is a page with its own title and a named back link ("‹ Calls"), never only a sheet. Tabs
keep their place: switching tabs returns to where you were in that tab; tapping the active
tab returns to its first screen. Tab switches are instant. The header on every screen is:
event pill (left) · search · your initials (right).
Visual polish is secondary. Use the tokens, keep it clean, spend your effort on the flow.
```

### AF1 — The organiser's one app

```
[A-BRIEF]
[AF add-on]

ROLES: Organiser (admin), Event lead.
FLOW: The organiser opens the app and lands on Today of the event they last used
(SHARMA26). Bar: Today · Calls · Hospitality · Logistics · Control (Control only for the
organiser; the event lead has four tabs).
Make these journeys work end to end, each in the tap count shown:
1. Switch event (2 taps): event pill → pick "PATEL27". You stay on the same tab in the new
   event. The pill updates everywhere.
2. Rotate an access code (4 taps): Control → Access codes → Rotate (Team code) → confirm in a
   sheet that says "Everyone signed in with this code will be signed out and must enter the
   new one."
3. New event: pill → "+ New event" → 3 steps (name + code, dates + venue, review) → Create →
   lands on the NEW event's Today, which shows a SETUP CHECKLIST card: Import the guest list ·
   Add staff names · Add hotels & rooms · Share the team code. Each item is one tap to its
   screen; completing one (simulate with a button on that screen) ticks it; when all four are
   done the card disappears.
4. From a Calls screen, open a family, then use Android Back three times — prove it returns
   to the Calls list, then the Calls first screen, then Today, and never into Control.
5. Control contains: People (Staff, Access codes), Guests (Import, Export, Files), Venue
   (Hotels & rooms), Messages (Send, Templates, Sent), Records (Ledger), Event (Section
   locks, Arrival alerts switch), Archive this event (alone, last, red). Every one opens a
   simple placeholder page with a named back link "‹ Control".
Show the event lead role: identical except no Control tab and no "+ New event".
```

### AF2 — The caller's loop

```
[A-BRIEF]
[AF add-on]

ROLES: Caller, Event lead.
FLOW: A caller signs in with a code, picks their name from a grid ("Who's using this phone
today?"), and lands on Calls → Next. Bar: Next · List · Review.
1. The loop (4 taps per family): Next shows ONE family on a big card → "Call" → a simulated
   phone-dialler interstitial ("You're in the phone app. Come back when the call ends." with
   a "Hang up and return" button — this tap is not counted) → the outcome step: five big
   tiles (Coming · Not coming · Maybe · Call back · No answer) → Coming reveals guests
   stepper + arrival day chips in place → Save → a "Saved · Undo" bar, and after 1.2s the
   next family slides in. Do 3 families in a row.
2. Call back: choosing Call back asks "When?" (In 1 hour · This evening · Tomorrow morning);
   that family then appears at the top of Next at that time and on Today (lead role) under
   "Needs you".
3. Someone else is on it: one family shows "Priya is logging this family — you can call, but
   only Priya can save the answer. Frees up by 9:47pm." The Call button still works; the
   outcome step is read-only with that message.
4. List tab: filter chips with counts (To call · Call back · No answer · Coming · Not coming
   · All); each chip changes the URL-like path shown in a small bar outside the frame
   ("/calls?show=callback") to prove filters are addressable.
5. Review tab: two AI summaries waiting; open one, confirm, back to Review.
Event lead role: same, plus an "Auto-call" entry at the top of List.
```

### AF3 — The family page is the centre

```
[A-BRIEF]
[AF add-on]

ROLES: Event lead, Hospitality runner, Family (client).
FLOW: Search (header) → type "shah" → results grouped Families / Guests / Rooms → open
"Shah Parivar". This is THE FAMILY PAGE: one screen answering everything about one family.
Sections in order, each a card with a link to its job screen: Answer (status, 6 of 7
guests coming, logged by Ravi 2 days ago) · Travel (arrival 19 Dec 6E 5074 10:30 Ahmedabad
T2, car: Innova MH04 · departure 21 Dec) · Stay (JW Marriott, Room 304, 3 beds, 19–21 Dec) ·
Hamper (not delivered) · Calls (3 attempts with outcomes) · People (names) · Notes.
The page has ONE primary action that depends on the family's phase. Add a PHASE switcher
outside the frame and show all six: Not called → "Call"; Promised call back 6pm → "Call
back · promised 6:00pm"; Coming, landing today → "Check in"; Checked in, hamper pending →
"Deliver hamper"; Checked in, all done → no button, the page is a record; Not coming → no
button, a quiet "Change answer" link.
Tapping Travel → the arrivals screen with this family highlighted; back returns to the family
page. Tapping Stay → the room page; back returns to the family.
Hospitality runner role: Answer and Calls are hidden (not their department); Stay and Hamper
are shown. Family (client) role: Answer, Travel and Stay only, read-only, no phone numbers,
no staff names.
```

### AF4 — Arrival day

```
[A-BRIEF]
[AF add-on]

ROLES: Logistics runner, Hospitality runner, Event lead.
FLOW: 19 Dec, 10:20am.
1. Logistics runner lands on Arrivals (bar: Arrivals · Departures · Trips · Fleet): today's
   landings by time. 6E 5074 shows "Landed" (haldi pill), Shah Parivar, 6 guests, car
   assigned. One row shows "No car yet" in red → Assign → pick a vehicle from a sheet that
   shows luggage-adjusted seats ("Tempo Traveller · 14 with luggage") → assigned, Undo bar.
2. Hospitality runner lands on Rooms (bar: Rooms · Check-in · Rooming list). Check-in lists
   "Arriving now" first; tap Shah Parivar → the family page with "Check in" as the primary
   action → member rows with check toggles, "Check in all 6" → done, room 304 + "2 keys" shown
   big (3 taps from Check-in).
3. Event lead on Today sees "Needs you": "No car for 6E 2231 landing 11:05 → Assign" — one tap
   lands on the Assign sheet directly (deep link), and Back returns to Today.
Show the Android-back behaviour when the Assign sheet is open (closes the sheet first).
```

### AF5 — Runners' apps: one job each

```
[A-BRIEF]
[AF add-on]

ROLES: Hamper runner, Setup runner, Hospitality runner, "No name picked".
FLOW:
1. Hamper runner: NO bottom bar. Lands straight on the next delivery ("Deliver to Room 304 —
   Shah Parivar") with the remaining list below. Deliver → camera → photo → Confirm (with the
   one-time "This photo is permanent proof" note) → the green seal → auto-advance to the next.
2. Setup runner: NO bottom bar; a checklist of setup tasks for the venue.
3. Hospitality runner trying to open a Calls link (simulate a shared link button outside the
   frame): a calm "This is the Calls team's screen" page with a button back to their Rooms —
   not an error.
4. "No name picked": Today shows one row at the top: "Pick your name so your work is saved
   under it" → the name grid → back to where they were.
```

### AF6 — First run and the family's view

```
[A-BRIEF]
[AF add-on]

ROLES: New staff member, Returning staff member, Family (client), Revoked code.
FLOW:
1. New staff: sign-in code (8 boxes) → "Who's using this phone today?" name grid → lands by
   department (show the table of landings in a small legend outside the frame).
2. Returning staff next morning: app opens straight to the name grid with yesterday's name
   pre-selected → one tap → their landing.
3. Family (client) signs in with the client code → the family view: couple's names, dates,
   "412 guests coming", Today card (arriving / checked in), the families list read-only.
   There is no bar, no search, no staff names, no phone numbers.
4. Revoked code: any screen → a full-screen "This code was changed by your admin. Ask them
   for the new one." → back to the code screen.
```

---

## A0 — The design system sheet (first SCREEN prompt; lock the winner)

```
[A-BRIEF]

SCREEN: A single scrollable "design system" page inside the phone frame that every later
screen will be judged against. Show, with live working examples:
1. Colour swatches with token names and the rule for each (action / now / done / attention).
2. The type scale: display 72/56/32, UI 24/20/16/14/12, mono figures, an eyebrow label,
   and a Gujarati name "રમેશભાઈ શાહ" rendering correctly.
3. Buttons: primary (indigo), secondary (ink outline), quiet (text), destructive (red
   outline), haldi "now" button; each with pressed state and a "Saved on this phone" variant.
4. A list row (64px): avatar initials circle, family name, one muted meta line, a status pill
   on the right, chevron. Plus the same row selected, pressed, and with a red attention edge.
5. Status pills: Coming (green), Not coming (ink, struck), Maybe (amber), Call back (amber
   with clock), No answer (muted), Not called (outline).
6. Chips with counts ("To call · 84"), a segmented control (3 options), a search field.
7. The Now card (dark): current family, big name in Instrument Serif, a haldi "Call" button.
8. A stat block: huge number "412 guests" (italic unit), with 3 small tappable sub-stats.
9. A bottom sheet that opens from a button and drags closed.
10. The tab bar: Today · Calls · Hospitality · Logistics · Control, with the active tab as an
    indigo glyph in a brand-tint pill, and an event pill header "SHARMA26 ▾".
11. Toasts: an Undo bar ("Moved Shah family to 304 · Undo"), and a sync chip in 3 states.
12. Empty, error and offline blocks, each with a next action.
Make it feel like a premium product, not a component zoo: editorial spacing, big type,
restraint. This page becomes the spec.
```

Save the winner as `design/arena/A0-design-system.tsx`. **Do not run A1+ until A0 is locked**
— paste A0's winning code under A-BRIEF in every later prompt with the line
`Match this design system exactly:` so both arena models build the same language.

---

## A1 — App shell: header, event pill, tab bar, search

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: The app shell, with a placeholder body. Build:
- Header (solid, sticky, 56px): left an EVENT PILL "SHARMA26 · Sharma–Patel ▾" (truncates
  gracefully at 360px); right a round search button and a round avatar with the staff
  member's initials. A 1px rule appears under the header only once the body has scrolled
  (opacity only).
- Tapping the event pill opens a bottom sheet: current event checked at the top with its
  dates; a list of 3 other events; "All events" and "+ New event" rows (admin only). Include a
  visible note in the sheet: "You are editing SHARMA26" in the current row.
- Tab bar (bottom, 64px + safe area): Today · Calls · Hospitality · Logistics · Control.
  Control only when a toggle outside the frame says "Signed in as admin"; for "Signed in as
  caller" the bar shows Today · Calls only. Tab switches are instant — no slide, no fade.
  Active = indigo glyph in brand-tint pill + indigo label; a small red dot badge on Calls
  showing "3" callbacks due.
- Tapping search opens a full-screen "Find anything" sheet (see A11 — here just the open/close
  and the input focused).
- Avatar opens a small sheet: your name, "Switch person", "Sign out".
States to show: admin, caller, offline (a thin ink banner under the header: "No signal —
anything you save waits on this phone"), and a long event name.
```

## A2 — Today (management + admin home)

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Today — the first screen an organiser sees. It answers "how are we doing, and what
needs me right now", in that order, above the fold on a 360×740 phone.
- Hero (Now card, dark): "412" in Instrument Serif 72px with italic "guests coming", under it
  "from 238 families · 62 still to call". The number counts up ONCE on first load.
- Bucket strip: five tappable tiles in a horizontal scroll with snap — Coming 412 guests /
  171 families · Not coming 38/19 · Maybe 22/9 · No answer 41/24 · Not called 62/15. Each
  shows guests big and families small. Tapping one opens that list (show the Coming list as a
  sheet).
- "Needs you" list (the heart of the screen): 3–6 rows ranked by urgency, each a full-width
  row with one action — "3 families asked for a call back before 6pm → Call", "Room 304 is
  over capacity → Fix", "Flight 6E 5074 lands in 40 min, no car assigned → Assign",
  "2 hampers waiting for photo proof", "Nobody has picked their name today → Remind".
  Attention rows carry a 3px red leading edge. When everything is calm, this list becomes one
  calm line: "Nothing needs you. 14 calls done in the last hour." — design that state.
- "Today's arrivals" timeline: a compact vertical timeline of the next 4 landings with time
  in mono, family, flight, car status pill.
- Nothing else. No explanatory paragraphs.
States: busy day, calm day, empty event (no guest list yet → big "Import the guest list"
action), loading (laid-out skeleton, not a spinner), error, offline.
```

## A3 — Control (the admin's home on a phone) — THE key screen

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Control — every admin tool for the current event, reachable in ONE tap from this
screen. Today, on this app, those tools are hidden behind a "More" sheet and the event
switcher is three taps deep; this screen replaces all of that.
Design it as a grouped list in the spirit of iOS Settings — calm, scannable, fast — not a
dashboard of cards:
- Top: large title "Control" (Instrument Serif 32px) and under it the event pill repeated as
  a big card: "SHARMA26 — Sharma–Patel Wedding · 18–21 Dec · JW Marriott Surat", with
  "Switch" on the right.
- A health strip of 3 small tappable facts: "Codes live 3", "Staff named today 7 / 11",
  "Last export 2h ago".
- Groups (eyebrow title + white rounded group, 56px rows with icon, label, value on the right,
  chevron):
  PEOPLE — Staff · 11 people   |   Access codes · 3 live · rotated 2 days ago
  GUESTS — Import guest sheet  |   Export to Excel   |   Files · 6
  VENUE — Hotels & rooms · 2 hotels · 148 rooms
  MESSAGES — Send a message   |   Templates · 5   |   Sent log · 214
  RECORDS — Ledger
  EVENT — Section locks · Calls locked   |   Arrival alerts · On (inline switch that works
  and shows an Undo bar)
  Then, alone at the very bottom after a big gap: "Archive this event" in red text.
- A search field at the top of the list filters rows as you type ("cod" → Access codes).
- Bottom: a quiet version row "EventFlow final-09 · build 37347b3" — long-pressing it opens
  developer tools. Developer tools are NOT in the list.
Include the detail of ONE row opened: tapping "Access codes" pushes a detail screen (transform
enter 240ms) showing 3 codes (Team, Client, Desk) with a masked value, "Reveal" (logs who
revealed), "Copy", and "Rotate". Rotate is irreversible for live sessions: it confirms ONCE
in a sheet that says plainly "Everyone signed in with this code will be signed out and must
enter the new one." with a red confirm.
States: normal, a warning state (no staff named yet → an amber row at the top "No staff
names yet — calls and photos will be saved against nobody → Add staff"), offline (rows still
open, writes show "Saved on this phone"), non-admin (this tab does not exist — show the
"not for you" fallback).
```

## A4 — Events list + New event wizard (admin)

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: All events + creating a new one.
Part 1 — All events: large title, a list of event cards (code in mono, name, dates, venue,
guests count, a status pill Live / Upcoming / Archived). Current event marked. Archived ones
collapse under "Archived · 4". A floating indigo "New event" button bottom-right above the
tab bar.
Part 2 — New event wizard in a full-height sheet, 3 steps with a thin progress bar at the
top (transform scaleX only): (1) Name + event code (auto-suggested from the name, editable,
mono, uniqueness hint), (2) Dates + main venue, (3) Review — shows the three access codes that
will be created and a big "Create event" button. On create: optimistic — the sheet closes and
the new event appears at the top of the list in a "Creating…" state that becomes Live.
States: first-ever event (no list — an inviting empty state), a code-taken validation error,
create failed (row turns into an honest error with Retry), offline (Create is disabled with
the reason, because this action cannot be queued).
```

## A5 — Staff (admin)

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Staff — the people who can log calls and deliveries under their own name.
- Title "Staff · 11". A segmented control: All · Calls · Hospitality · Hampers · Logistics
  (departments), with counts.
- Rows: initials avatar, name, department pill, "Picked their name today 9:14" or "Not seen
  today" in muted, and on the right a mono count of today's actions.
- Add person: an inline row at the top "+ Add a person" that expands in place into a name
  field and a department chooser — no separate page. Adding is optimistic with an Undo bar.
- Swipe a row left to reveal "Move department" and "Remove" (remove is blocked with a plain
  explanation if they already logged calls: "Ravi has 38 calls saved under his name, so he
  can't be removed. You can hide him from the picker instead.").
States: empty ("Nobody yet. Add the people who will make calls so every call is saved
under a name."), loaded, a remove-blocked sheet, offline.
```

## A6 — Messages (admin): send, templates, log

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Messages — send WhatsApp messages to families from templates.
- Top segmented control: Send · Templates · Sent.
- Send: step 1 pick a template (cards with a two-line preview; the three core ones pinned:
  "RSVP request", "Room + arrival confirmation", "Pickup details"); step 2 pick who (chips
  with counts: Everyone coming 171 · Not called 15 · Arriving tomorrow 23 · Pick families…);
  step 3 a real preview of ONE family's message with their name and room filled in, and a
  sticky bottom bar "Send to 23 families". Sending shows a live progress (sent / failed
  counts in mono) that keeps going if the user leaves the screen.
- Templates: list + an editor with variable chips ({family}, {room}, {pickup_time}) you tap to
  insert, and a live preview.
- Sent: a log grouped by day, each row: family, template, time, status pill Delivered / Read
  / Failed (failed has "Retry").
States: sending in progress, partial failure, empty log, offline (Send disabled with reason).
```

## A7 — Hotels & rooms setup (admin)

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Hotels & rooms setup.
- List of hotels as cards: name, city, rooms total, a thin occupancy bar (transform scaleX),
  "148 rooms · 131 filled".
- Hotel detail: rooms grouped by floor; "+ Add rooms" opens a sheet: room type (Single /
  Double / Triple / Suite as chips), quantity stepper, starting number ("401"), a live preview
  of the numbers that will be created ("401–412 · 12 double rooms"), and existing numbers that
  will be skipped shown in muted strike-through.
- Import hotels from a sheet: a drop/choose file card, then a preview table with warnings
  (duplicate room 304, blank type on row 17) BEFORE anything is written, and "Import 146 rooms".
States: no hotels yet, import preview with warnings, import done, offline.
```

## A8 — Calls: the queue ("Call next")

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Calls — the caller's whole day. The unit is the FAMILY, not the guest: you dial one
number and the family head answers for everyone.
- Top: the NOW card (dark): the next family to call — family name huge (Instrument Serif),
  head's name, city, expected guests in mono, the last attempt ("No answer · yesterday 7:40pm
  · attempt 2"), and a giant haldi "Call" button (full width, 64px). Under it a quiet
  "Skip for now".
- Filter chips with counts, one row, horizontally scrollable with snap and NO visible
  scrollbar: To call 84 · Call back 3 · No answer 24 · Coming 171 · Not coming 19 · All 238.
- Below: the rest of the queue as compact rows (name, city, expected guests, last outcome
  pill). If another caller is on a family right now, the row shows "Priya is on this · 2 min"
  in amber and cannot be opened for logging (it can still be dialled).
- Progress at the very top as a thin bar: "154 of 238 families reached today".
States: normal, callbacks due (Call back chip has a red count and the Now card is the
earliest callback with "Promised for 6:00pm"), queue finished ("Everyone's been called."),
offline.
```

## A9 — The call screen + outcome logging

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: A call in progress, and logging what the family said. Three phases in one screen:
PHASE 1 — Before dialling: family name, head, phone number in mono, "Last time: Coming, 6
guests, arriving by train", big haldi "Call Rameshbhai".
PHASE 2 — In call (after returning from the phone dialler): a full-bleed NOW surface with a
timer in Geist Mono counting up, the family name, and a RECORDING indicator: a red dot with a
single slow pulse and the words "Recording this call". Show three alternative recording
states the design must handle calmly (toggle outside the frame): "Recording", "This phone
can't record calls — add a voice note after", and "Recording saved on this phone, will upload
when there's signal". Plus a "Add a voice note instead" button.
PHASE 3 — What did they say? Five BIG outcome tiles, 2-column grid, each 96px tall with an
icon and a plain word: Coming · Not coming · Maybe · Call back · No answer (and a small
"Wrong number" text button). Choosing Coming reveals, in place (no new screen): a guests
stepper (big − and + around a mono number, prefilled with expected 6), arrival date chips
(18 Dec · 19 Dec · 20 Dec · Other), travel mode chips (Flight · Train · Car · Bus), an
optional flight/train number field, and a notes field. Choosing Call back reveals time chips
(In 1 hour · This evening · Tomorrow morning · Pick…). Sticky bottom "Save" — tapping it is
optimistic: the tile morphs into a check, a "Saved · Undo" bar appears, and the screen moves
to the next family after 1.2s.
States: the three phases, lock held by someone else ("Priya is logging this family — you
can still call, but only Priya can save the answer. Frees up by 9:47pm"), save failed,
saved on this phone.
```

## A10 — Review what the AI heard

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Review — after a call recording is transcribed, the app extracts the answer. A human
must confirm before anything is saved. Nothing auto-saves.
- Top: family name, call time, duration, a compact audio player (play/pause, a scrubber
  moved by transform, 1x/1.5x/2x).
- The transcript, speaker-labelled (Caller / Family), Gujarati and Hindi lines shown in their
  own script with a small English gloss under each.
- The extracted answer as editable fields: Status, Guests, Arrival date, Arrival time, Mode,
  Flight/train number, Pickup point, Special requests. Each field shows a confidence dot;
  anything under 80% has an amber background and the words "Check this". Tapping a field
  scrolls the transcript to the sentence it came from and highlights it.
- Sticky bottom: "Save to family" (primary) and "Not usable" (quiet).
States: high confidence, several low-confidence fields, a flight number the AI refused to
guess (empty, with "Not mentioned"), already-saved (read-only with who saved it), offline.
```

## A11 — Find anything (global search)

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Find anything — a full-screen search that opens from the header.
- Input auto-focused, 56px, with a clear button; results update per keystroke with no
  spinner (local-first).
- Before typing: "Recent" (last 5 families opened) and quick jumps: "Call back list",
  "Arriving today", "Over-capacity rooms", and for admins "Access codes", "Send a message".
- Results grouped: Families · Guests · Rooms · Vehicles · Tools (admin only). Matches
  highlighted in the name. Search by phone number (last 4 digits), room number, flight
  number, and Gujarati script all work in the mock.
- Each result row has one inline action on the right: Call (family), Open (room), Assign
  (vehicle).
States: recent, results, no results ("No one called 'Dessai'. Did you mean Desai?"), offline
(searches what's on this phone, and says so).
```

## A12 — Hospitality: rooms board + place a family

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Hospitality — Rooms. Segmented control at the top: Rooms · Check-in · Hampers.
- Venue selector pill (JW Marriott ▾) and a "Filter · 2" button opening a sheet (Type multi,
  Status: Empty / Partly filled / Full, each chip with a count).
- The board: rooms as tiles in a 3-column grid grouped by floor. Each tile shows the room
  number (mono, big), the family surname in it (this is the point — people, not numbers),
  and "2/3 beds". Tile tint: empty green-tint, partly amber-tint, full surface with ink,
  over capacity red edge. Legend as one line.
- Select-then-place: tap an unplaced family in a bottom tray ("Unplaced · 7" peeking from the
  bottom), then tap a room → placed instantly with an Undo bar. If the room would go over
  capacity: a sheet explaining it plainly with "Put an extra bed (override)" + reason field;
  if the user is trying to swap two full rooms, instead say "Empty one of these rooms first —
  two full rooms can't swap directly."
- Tapping a room tile opens its sheet: guests in it, dates, move/remove.
States: normal, filtering, unplaced tray open, over-capacity sheet, swap-blocked sheet,
offline.
```

## A13 — Check-in, hamper run, and the photo-proof seal

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Three short flows, shown as tabs outside the frame.
1. CHECK-IN: search/scan list of families arriving today; a family card with each member as a
   row and a big check toggle per member plus "Check in all 6". Checking in is instant with
   Undo. Room number and key count shown large.
2. HAMPER RUN: a runner's list of hampers to deliver, grouped by room/floor, next one on a
   Now card with "Deliver to Room 304 — Shah Parivar".
3. PROOF: camera viewfinder (use a placeholder image), a big round shutter, then the photo
   preview with "Retake" and "Confirm delivery". Confirm is IRREVERSIBLE — a proof can never
   be edited or deleted — so it confirms once plainly ("This photo is permanent proof. It
   can't be changed or deleted.") and waits for the server with an honest "Sealing…" state.
   On success: THE SEAL — a green stamp "Delivered · 4:12pm · Ravi" scales from 1.2 to 1 with
   a single soft settle. This is the one flourish in the whole app; make it beautiful and
   still transform/opacity only.
States: proof uploading on slow network, proof saved on this phone (queued), seal failed.
```

## A14 — Logistics: arrivals, trips, fleet

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: Logistics. Segmented control: Arrivals · Departures · Trips · Fleet.
- Arrivals: a day selector (18 · 19 · 20 · 21 Dec as big date chips with counts), then a time
  column list: time (mono, big), family, guests, flight/train, pickup point, and a car status
  pill (Car assigned — Innova MH04 · No car yet in red). A live "Lands in 40 min" haldi pill
  on the next one only.
- Trips: a planned trip card — vehicle, driver, seats used "11 / 14" as a filled bar (scaleX),
  stops in order, families aboard. "Suggest vehicles" produces an advisory plan the human
  commits.
- Fleet: vehicles with luggage-adjusted capacity shown honestly ("Tempo Traveller · 17 seats
  · 14 with luggage"), status (Available / On a trip / Unavailable), driver.
States: busy arrival day, a flight delayed (amber), no car for a landing (red, action
"Assign"), offline.
```

## A15 — The family (client) view

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner] — but on the client paper #FBF7F0.

SCREEN: What the wedding family (the client) sees: read-only, elegant, for an older person in
a bright hotel lobby. Larger type (18px base).
- A welcome header with the couple's names in Instrument Serif and the dates.
- Their guest count ("412 guests coming") and a simple list of families with status and
  arrival — no internal tools, no staff names, no phone numbers.
- A "Today" card: who is arriving and who has checked in.
States: loaded, loading, no access.
```

## A16 — Sign in, pick your name, and the failure screens

```
[A-BRIEF]
Match this design system exactly: [paste A0 winner]

SCREEN: The first 20 seconds of the app, and the screens nobody designs.
1. Sign in: the EventFlow mark, one field "Event code" (mono, auto-uppercase, 8 chars shown as
   separate boxes), "Continue". Admin sign-in as a quiet link to email login. The one screen
   allowed a soft haldi gradient wash in the background.
2. Pick your name: "Who's using this phone today?" — a grid of big name tiles (initials +
   name + department), a "Skip for now" quiet link that warns once: "Calls you save won't
   show your name."
3. No signal full screen (app couldn't start): "No signal. EventFlow needs the internet to
   open. Anything you saved earlier is safe on this phone." + Try again.
4. Crash screen: "Something broke on this screen. Go back, or reload. If it keeps
   happening, send your admin this code: EF-7Q2K."
5. Update required: "A new version of EventFlow is ready" + Install.
States: each of the five, plus wrong code and code revoked ("This code was changed by your
admin. Ask them for the new one.").
```

---

# PART B — THE PORT PREAMBLE (paste at the top of every C prompt)

```
You are working in C:\dev\EventFlow — a Next.js 16 / React 19 / Supabase / Capacitor app for
running Indian wedding guest operations on cheap Android phones over bad venue Wi-Fi. The
APK is a remote shell over the deployed site (CLAUDE.md §11c), so there is no local bundle and
every network hop is felt. This session ports ONE winning arena.ai prototype into the real
app. The prototype is a DESIGN, not code to paste: it uses mock data, lucide-react icons and
hex CSS variables, and none of those three belong in src/.

Before you write any code:
1. Read CLAUDE.md §5, §6, §7, §12 and §14. House rules, not suggestions.
2. Read UI4-ARENA-PROMPTS.md sections 2, 3 and 4 (tokens, 60fps contract, IA).
3. Read docs/UX-RULES.md and docs/INTERACTION-CONTRACT.md. Every change satisfies both.
4. Read the arena winner named in "Design source" below, and only the files in "Read first".

Hard limits:
- Change ONLY the files in "Files you may change". If the task needs another, STOP and say
  which and why.
- NO database migrations. Do not touch supabase/, src/lib/supabase/, RLS, or any server
  action's write logic. If the design needs data the database does not expose, STOP and name
  the exact column, view or RPC that is missing — do not fake it on the client.
- NO new npm dependencies. motion (use `m` from motion/react-m under the existing strict
  LazyMotion), @tanstack/react-query and dexie are already installed. lucide-react is NOT —
  map every icon to src/components/icons.tsx, adding a new icon there if needed.
- Tailwind v4 is CSS-first. Tokens live in src/app/globals.css. There is no
  tailwind.config.js and there must not be one. Use token classes (bg-paper, text-ink,
  bg-brand, bg-now, text-ledger-red, shadow-e1, duration-press, ease-ledger…). A hardcoded
  hex or an arbitrary shadow-[…] in your diff is a failed session
  (tests/no-arbitrary-shadows.test.ts will catch the second).
- LIGHT APP. No dark mode, no prefers-color-scheme, no .dark. The Now card is the one dark
  surface and it uses the bg-now token.
- 60fps contract F1–F10 (UI4-ARENA-PROMPTS.md §3): transform/opacity only, NO
  backdrop-filter, no animated shadows, no per-row motion in long lists, no scroll-driven
  setState.
- FROZEN identifiers (CLAUDE.md §12): nuvent_* cookies and storage keys, appId com.nuvent.app,
  NUVENT_PERF_BASELINE, the template asset path. Do not rename, even though the brand is
  EventFlow.
- Do NOT touch the native recorder, CallPlugin, android/, capacitor.config.ts or anything
  under src/lib/native/ that records audio. Recording is the next series.
- Do NOT reformat code you are not changing. Keep every existing comment unless it is now
  false — then rewrite it to be true, keeping the reasoning that still holds.
- Mobile-first: 16px base, targets >= 48px, no horizontal scroll at 360px. Desktop (md:)
  must still work but is not the target.

When you are done:
- npm run typecheck — must be clean.
- npx eslint <files you changed> — those files clean. Do NOT quote repo-wide lint (it exits
  1 on a clean tree, CLAUDE.md §3).
- npm run test:run — everything that passed before still passes. If a nav/parity test pins
  the OLD contract and this prompt deliberately changes it, update the test in the same
  commit and say so explicitly.
- git diff --stat.
- Append what changed and why to DECISIONS.md (append, never rewrite).
- Tell me in plain words what an admin/runner can now do or feel that they could not before,
  and list anything you could NOT verify (no handset = unverified, CLAUDE.md §14).
```

**After every C session:** commit, then run it on a real handset with `npm run mobile:dev`
and do the four F10 gestures with Chrome remote DevTools recording. A green typecheck is not
a verified change.

---

# PART CS — BUILD THE STRUCTURE (Claude Code, before the screen restyles)

Use the same **PREAMBLE** (Part B) at the top of every CS prompt. Two extra lines for this
part — add them under the preamble:

```
STRUCTURE SESSION. You are changing WHERE things are and HOW you move, not how they look.
Use the existing components as they are; restyling is the C-series. Do NOT restructure
route groups or folders: new URLs are thin new page.tsx files in (app)/v2/[eventCode]
(plus the matching (staff) file if tests/v2-route-parity.test.ts demands one) that compose
existing components. Old URLs redirect; nothing is deleted.
The source of truth for every decision is docs/STRUCTURE.md (written in CS0). If it and
this prompt disagree, STOP and ask.
```

## CS0 — Write the structure down (docs only)

```
[PREAMBLE + structure lines]
Design source: UI4-ARENA-PROMPTS.md Part S, and the AF winners in design/arena/AF*.tsx

TASK: Write docs/STRUCTURE.md. No changes under src/.
- S1 re-verified: re-check every row of the S1 table against the current tree and correct
  anything that has moved. Quote file:line.
- The role → landing → bar table (S2), exactly as the AF winners implemented it; where an
  AF winner improved on Part S, say so and take the improvement.
- The route map (S3) as a table AND as the literal TypeScript array CS1 will paste into
  src/lib/nav/route-map.ts: { from: string, to: string, kind: 'redirect' | 'new' }[],
  with Next-style params (:e, :groupId, :deliverableId, :extractionId, :hotelId).
- The family page spec (S4), naming for each section the EXISTING read that fills it
  (function name + file). Any section with no existing read: mark MISSING and name the
  column/view/RPC it would need — do not design a migration.
- The 14 flows (S5) with before/after taps, and N1–N10 (S6) with their pass conditions.
Read first: UI4-ARENA-PROMPTS.md Part S, design/arena/AF*.tsx, src/lib/sections/{config.tsx,v3.ts},
  src/lib/departments.ts, src/lib/events/paths.ts, src/components/native/NativeBridge.tsx,
  src/proxy.ts, the (app)/v2/[eventCode] route list
Files you may change: docs/STRUCTURE.md, DECISIONS.md
Done when: every S1 row has a verified file:line, every family-page section names its read
  or is marked MISSING, and git status shows nothing under src/.
```

## CS1 — The route map and the redirects

```
[PREAMBLE + structure lines]
Design source: docs/STRUCTURE.md §route map

TASK: Make every new URL resolve and every old URL redirect, from ONE table.
1. src/lib/nav/route-map.ts — the array from STRUCTURE.md, exported, with a one-paragraph
   header comment saying it is the only place a route move is recorded.
2. Redirects: read src/proxy.ts and next.config.ts first and decide WHERE redirects run
   relative to the NEXT_PUBLIC_UI=v2 rewrite (Next applies next.config redirects before
   middleware/proxy — verify this against the installed Next 16 docs in node_modules, do not
   trust this sentence). Implement them from route-map.ts so the table cannot drift from
   behaviour. Preserve the query string and hash.
3. New thin pages for every 'new' entry, composing existing components with the SAME guards
   the page they replace uses (copy the guard line for line, as the v2 production page
   did). The family page and the merged call flow are placeholders here that render the
   existing screens (rsvp/status content for now) — CS5 and CS6 build them properly.
4. tests/route-map.test.ts: every 'redirect' entry's `from` is reachable in the old tree and
   its `to` exists as a page in the new tree; no `to` is itself a `from` (no chains); no
   duplicate `from`.
5. Update tests/v2-route-parity.test.ts's allowlist for the genuinely new routes, and say
   which in DECISIONS.md.
6. Update internal links that point at a replaced URL (grep for each `from`) so the app never
   relies on its own redirects for normal navigation (a redirect is a wasted round trip,
   T5). List every file changed.
Read first: docs/STRUCTURE.md, src/proxy.ts, next.config.ts, tests/v2-route-parity.test.ts,
  src/lib/sections/config.tsx
Files you may change: src/lib/nav/route-map.ts, src/proxy.ts OR next.config.ts (whichever
  step 2 chose — not both), the new page files, files with links to replaced URLs,
  tests/route-map.test.ts, tests/v2-route-parity.test.ts, DECISIONS.md
Done when: typecheck + tests clean, and `curl -sI` against `npm run dev` for five old URLs
  shows a 308 to the right new URL (paste the output).
```

## CS2 — Land every role in the right place

```
[PREAMBLE + structure lines]
Design source: docs/STRUCTURE.md §landings

TASK: Implement the S2 landing table.
- departmentHomePath (src/lib/departments.ts): management → /{e} (Today), rsvp →
  /{e}/calls, hospitality → /{e}/hospitality, hamper → /{e}/hampers, logistics →
  /{e}/logistics/arrivals, production → /{e}/setup. Rewrite the comment on management — it
  currently justifies campaigns; say why Today now.
- eventHomePath (src/lib/events/paths.ts): client → /{e}/families.
- The root page (src/app/page.tsx) for admins: the last-opened event from a NEW device key
  `ef_last_event` (localStorage, try/catch, written when an event layout mounts); fall back
  to the first membership, then /events. Do NOT touch any nuvent_* key (CLAUDE.md §12).
- Returning staff: if the code session is live, open on the name picker with yesterday's
  name pre-selected (read the existing staff cookie; do not rename it).
- tests/landing.test.ts: one assertion per row of the S2 table.
Read first: src/lib/departments.ts, src/lib/events/paths.ts, src/app/page.tsx,
  src/app/pick-staff/*, src/lib/auth/cookies.ts (read only)
Files you may change: src/lib/departments.ts, src/lib/events/paths.ts, src/app/page.tsx,
  src/app/pick-staff/*, the event layout that writes ef_last_event, tests/landing.test.ts,
  existing tests that pin the old landings (update deliberately), DECISIONS.md
Done when: every role lands per S2 and the tests prove it.
```

## CS3 — The bars, per role

```
[PREAMBLE + structure lines]
Design source: docs/STRUCTURE.md §bars, design/arena/AF1-*.tsx, AF2, AF5

TASK: Implement the S2 bars in src/lib/sections/v3.ts (and config.tsx only where a child's
label/order/href must change).
- Lead: Today · Calls · Hospitality · Logistics. Organiser: + Control (a new SectionId
  'control', admin-only, href /{e}/control). Hampers leaves the lead's bar and is reached
  from Hospitality and the family page; the hamper RUNNER still gets Hampers as their whole
  app with no bar.
- Caller: Next · List · Review (Auto-call removed from the caller's bar; for the lead it is
  an entry at the top of List).
- Hospitality: Rooms · Check-in · Rooming list. Logistics: Arrivals · Departures · Trips ·
  Fleet. Hamper and Setup: no bar.
- The department predicates (who may SEE what) do not change. Only the bar shape changes.
- Update tests/v3-nav.test.ts and tests/nav-model.test.ts deliberately; replace old
  assertions with the S2 table rather than deleting them. Record which in DECISIONS.md.
Read first: src/lib/sections/{config.tsx,v3.ts,sidebar.ts}, src/components/nav/BottomTabs.tsx,
  tests/v3-nav.test.ts, tests/nav-model.test.ts
Files you may change: those, DECISIONS.md
Done when: each role's bar matches S2 exactly and every nav test passes.
```

## CS4 — Android back and tabs that keep their place

```
[PREAMBLE + structure lines]
Design source: Part S §S6 N3–N5, AF1–AF4 winners (their back-button behaviour)

TASK: Replace history.back() with the N4 order, and give tabs memory.
1. src/lib/nav/back.ts — a PURE function resolveBack(state) → action, where state = { open
   sheets count, current tab, current tab's stack, role landing tab, lastBackAt } and action
   ∈ close-sheet | pop | to-tab-root | to-landing | confirm-exit | exit. tests/back.test.ts
   covers every branch, including "opened by a deep link with no history" (→ tab root, not
   exit).
2. A small sheet registry: BottomSheet registers its onClose on open and unregisters on close
   (a module-level stack; no new dependency). NativeBridge's backButton listener asks the
   registry first, then resolveBack. Keep NativeBridge's web no-op guard (isNativePlatform).
3. Per-tab stacks (N3): record each tab's last URL and scroll position in sessionStorage
   (try/catch) on navigation; the tab bar links to the remembered URL; tapping the active tab
   goes to its root then to top. Pure reducer + tests.
4. Every detail page declares its parent URL (N5) and the back link uses it — grep for
   router.back() in page code and replace. List every file.
5. "Press back again to close EventFlow" as a 2s toast using the existing toast/UndoBar
   surface.
Read first: src/components/native/NativeBridge.tsx, src/components/ui/BottomSheet.tsx,
  src/components/ui/BackRow.tsx, src/components/nav/BottomTabs.tsx, src/lib/native/platform.ts
Files you may change: src/lib/nav/back.ts, src/lib/nav/tab-stack.ts, NativeBridge.tsx,
  BottomSheet.tsx, BottomTabs.tsx, BackRow.tsx, detail pages using router.back(),
  tests/back.test.ts, tests/tab-stack.test.ts, DECISIONS.md
Done when: tests clean, and on a HANDSET (this is native behaviour — a browser cannot prove
  it): sheet open → back closes it; Calls → family → back ×3 goes list → Calls root → Today;
  a deep-linked family → back goes to its tab root, not out of the app. Report what you ran;
  if no handset was available, say this is UNVERIFIED.
```

## CS5 — The family page

```
[PREAMBLE + structure lines]
Design source: docs/STRUCTURE.md §family page, design/arena/AF3-*.tsx

TASK: Build /{e}/families/[groupId] (placeholder from CS1) per S4.
- src/lib/family/next-action.ts: a PURE function familyNextAction(family, viewer) →
  'call' | 'call-back' | 'check-in' | 'deliver-hamper' | null, per the S4 table.
  tests/family-next-action.test.ts: one case per row, plus "viewer's department cannot do
  it" → null.
- Sections render from the EXISTING reads named in STRUCTURE.md, fetched in parallel
  (Promise.all, T5). A MISSING read → the section is omitted with a TODO naming the gap;
  do not add a query to src/lib/supabase and do not write a migration.
- Section visibility uses the same department predicates as config.tsx (import them — no
  new permission logic). Client: Answer, Travel, Stay, read-only, no phone, no staff names.
- Anchors #answer #travel #stay #hamper #calls for N8 deep links.
- Point every "open this family" link in the app at this page: search results, queue rows'
  secondary tap, arrivals rows, rooming list rows, room sheet occupants, Today's Needs-you
  rows. List every file.
Read first: docs/STRUCTURE.md, design/arena/AF3-*.tsx, the reads it names,
  src/lib/sections/config.tsx, src/lib/rsvp-queue.ts
Files you may change: the family route folder, src/lib/family/*, the link sites listed,
  tests/family-next-action.test.ts, DECISIONS.md
Done when: every phase in AF3 renders its right primary action, role hiding works, and the
  link sites all land here.
```

## CS6 — One URL for a call

```
[PREAMBLE + structure lines]
Design source: design/arena/AF2-*.tsx, docs/STRUCTURE.md

TASK: /{e}/families/[groupId]/call becomes the whole call: step 1 before-dial, step 2
in-call (return from dialler), step 3 outcome. Old rsvp/call/[groupId] and
rsvp/status/[groupId] already redirect (CS1).
THE INVARIANTS — the diff is rejected if any changes (CLAUDE.md §5.4, §6, §12):
- The call_attempts row is written BEFORE the dial fires; its id goes to sessionStorage;
  on resume the flow rehydrates from it (resume-first). Dial via openExternalUrl only.
- Step 1–2 stamp last_opened_by_staff presence exactly as the call screen does now, and
  neither claim nor release the lock.
- Step 3 claims the lock on mount, exactly where the status screen claims it today
  (claimGroupForCall), and releases after a successful save (releaseGroupAfterCall), guarded
  so a caller only releases their own lock.
- The outcome is written once; the row freezes.
- The steps are ONE route with the step in state + ?step= in the URL, so a WebView discard
  during the dial restores to the right step.
- Auto-advance to /{e}/calls after save (1.2s) — the next family is the queue's job.
Do NOT touch the recorder (next series). Reuse CallScreen and RsvpLogForm internals; move
them only if unavoidable, and list every move.
Read first: src/components/call/CallScreen.tsx, rsvp/call/[groupId]/*, rsvp/status/[groupId]/*,
  src/lib/rsvp-queue.ts, src/lib/native/navigation.ts, CLAUDE.md §5.4 §6 §12
Files you may change: the families/[groupId]/call route folder, the two old route folders
  (redirect stubs only), src/components/call/CallScreen.tsx (composition only), DECISIONS.md
Done when: on a handset, Next → Call → dialler → return → outcome → Save → next family works;
  killing the WebView during the dial and reopening lands on step 2 with the same attempt id;
  and you have re-read the diff against each invariant and quoted the lines that keep it.
```

## CS7 — Merge the duplicates

```
[PREAMBLE + structure lines]
Design source: docs/STRUCTURE.md §route map

TASK: One place per job (N10). For each pair, the new URL renders the screen and the old one
already redirects (CS1); here you remove the second implementation's navigation entries and
make the remaining one complete.
- Hampers: /{e}/hampers[/id] only. Remove the "borrowed child" plumbing in config.tsx for
  hamper if nothing else needs it; DeliveryDetail's exits point at /{e}/hampers.
- Families directory: /{e}/families = the guest list + search, merged; the find route's
  search logic is reused (docs/guest-search-explain.md), not rewritten.
- Room creation: ONE form, reached from Control → Hotels & rooms; the hospitality "new
  room" entry links there.
- Import: Control → Import offers "Guest list" and "Hotels & rooms" as two choices, each the
  existing import flow.
- Unmatched recordings: a filter on Review (?show=no-family), same component.
- Setup: /{e}/setup renders the production screen.
Read first: src/lib/sections/config.tsx, the route folders involved, docs/STRUCTURE.md
Files you may change: those route folders, config.tsx, DECISIONS.md
Done when: grep shows each job linked from exactly one nav location, and route-map tests pass.
```

## CS8 — The new-event setup checklist

```
[PREAMBLE + structure lines]
Design source: design/arena/AF1-*.tsx (journey 3)

TASK: After creating an event, Today shows a setup checklist until it is done:
Import the guest list · Add staff names · Add hotels & rooms · Share the team code.
- Every tick is DERIVED from data that already exists — guest_groups count > 0,
  staff_members count > 0, hotels count > 0, a team code revealed at least once
  (code_reveal_log, written by the existing reveal action). No stored "done" flag: a stored
  flag drifts (the same reasoning as CLAUDE.md §5.4's counters).
- Admin and lead see it; runners never do. It disappears when all four are ticked.
- Each item is one tap to its Control screen.
- Creating an event lands on the new event's Today (not the admin dashboard).
- If one of the four counts has no existing read, STOP and name it — no new query layer.
Read first: CreateEventForm.tsx, src/lib/actions/access-codes.ts, the Today page and _home
Files you may change: the Today page/_home, a new _home/SetupChecklist.tsx,
  CreateEventForm.tsx (destination only), DECISIONS.md
Done when: a fresh event shows 0/4, each step ticks as it is done, and the card is gone at 4/4.
```

## CS9 — Measure the structure

```
[PREAMBLE + structure lines]
Design source: docs/STRUCTURE.md §flows, §N1–N10

TASK: Prove Part S. No features.
1. Add the 14 S5 flows as task definitions to e2e/v12-tasks.mjs (the file
   scripts/tap-budget.mjs and the spec both read), with the "after" count as the budget.
   Seed what they need through e2e/v12-seed.mjs.
2. Run node scripts/tap-budget.mjs against a production build (read its header for how) and
   paste the output. Before/after table into docs/STRUCTURE.md.
3. One test per navigation rule N1–N10 that can be checked without a handset; list the ones
   that can only be checked on a handset (N4 at least) and add them to docs/HANDSET-TEST.md.
Files you may change: e2e/v12-tasks.mjs, e2e/v12-seed.mjs, tests/nav-rules.test.ts,
  docs/STRUCTURE.md, docs/HANDSET-TEST.md, DECISIONS.md
Done when: every flow has a measured count or is marked NOT MEASURED with the reason.
```

---

# PART C — CLAUDE CODE PORT PROMPTS

**Paths after Part CS.** C6–C14 name files as they are on `37347b3`. If a CS session moved
or replaced a route, use the new location — `src/lib/nav/route-map.ts` and
`docs/STRUCTURE.md` are the lookup. The C-series changes how screens LOOK; it must not undo
a structure decision.

## C0 — Lock the design decision (docs only)

```
[PREAMBLE]
Design source: design/arena/A0-design-system.tsx

TASK: Write docs/DESIGN-V4.md — the design spec every later C session is graded against —
from the A0 winner and UI4-ARENA-PROMPTS.md §2. No changes under src/.
- Tokens table: every --ef-* token, old value, new value, role, and the contrast ratio of
  each text pair (compute them; do not copy mine without checking).
- Type, shape, motion, the three signature moments, the colour rules (indigo = action,
  haldi = now max one per screen, green/red absolute, not-coming is ink).
- The component inventory from A0 mapped to the existing file that will carry it
  (src/components/ui/*). Mark which need a new file.
- A "Differences from the prototype" section: anything in A0 that breaks F1–F10 or UX-RULES
  and how the port will differ.
- Mark DESIGN.md (Royal Ivory) and FRONTEND_DESIGN_STITCH.md (Organic) as superseded with a
  one-line pointer at their top. Do not delete them.
Read first: design/arena/A0-design-system.tsx, src/app/globals.css, DESIGN.md,
  src/components/ui/ (file list only), docs/UX-RULES.md
Files you may change: docs/DESIGN-V4.md, DESIGN.md (top line only),
  FRONTEND_DESIGN_STITCH.md (top line only), DECISIONS.md
Done when: the file exists, every token has a value and a ratio, and git status shows nothing
under src/.
```

## C1 — Swap the tokens and the fonts

```
[PREAMBLE]
Design source: docs/DESIGN-V4.md

TASK: Re-skin the whole app by changing token VALUES, not names.
1. src/app/globals.css: set every --ef-* value in :root and [data-theme='client'] to
   DESIGN-V4.md. Keep every token name. Add --ef-radius-control 14px, --ef-radius-card 24px,
   --ef-radius-sheet 32px and expose them in @theme inline. Update the motion tokens to
   90 / 160 / 240ms and ease cubic-bezier(0.16,1,0.3,1). Keep the historical-note comment
   block and add a dated line under it recording this re-skin and how to revert.
2. src/app/layout.tsx: replace the Bricolage/Figtree next/font imports with Instrument Serif
   (400, normal+italic), Geist, Geist Mono; keep IBM Plex Sans Devanagari; add Noto Sans
   Gujarati. Keep the variable names the CSS reads (--font-display, --font-sans, --font-mono
   or whatever globals.css actually reads — check, don't guess). Subset latin only for the
   Latin families. Keep the long comment about why next/font and not a <link>.
3. src/lib/motion/tokens.ts: match the new durations/ease; update
   tests/motion-tokens.test.ts if it pins numbers.
4. Search for leftover hardcoded brand hex from the old skins (#7f1d3a, #e8a33d, #735c00,
   #d4af37, #c67139) under src/ and replace with tokens. global-error.tsx is the exception —
   it must stay inline hex (no stylesheet exists there); update its values to the new palette
   and keep the comment saying why.
5. Update themeColor in layout.tsx only if the paper changed; if it did, list the native
   files (colors.xml, styles.xml, capacitor.config.ts StatusBar) that must follow in a LATER
   APK build, but DO NOT edit them — say so in DECISIONS.md.
Read first: src/app/globals.css, src/app/layout.tsx, src/lib/motion/tokens.ts,
  src/app/global-error.tsx, tests/motion-tokens.test.ts, docs/DESIGN-V4.md
Files you may change: those six, DECISIONS.md, and any src/ file that contains one of the
  five old hex values (list them before changing).
Done when: the app renders in Haldi & Ink with zero component edits besides hex removal,
  typecheck/tests clean, grep for the five old hexes under src/ returns only global-error's
  history comment.
```

## C2 — Make 60fps a test, not a hope

```
[PREAMBLE]
Design source: UI4-ARENA-PROMPTS.md §3

TASK: Turn F1–F10 into enforcement.
1. Append rules T8–T12 to docs/INTERACTION-CONTRACT.md, one per group: T8 compositor-only
   motion (F1, F3), T9 no backdrop-filter (F2), T10 cheap long lists (F4, F5), T11 no
   scroll-driven JS / layout reads (F6, F7), T12 measured frames (F8, F10). Same format as
   T1–T7: why, pass condition, right/wrong with REAL file paths from this repo (grep for
   current offenders — there will be some).
2. tests/no-expensive-css.test.ts: fail if any .tsx/.ts/.css under src/ contains
   backdrop-blur, backdrop-filter, `transition-all`, or a motion animate/transition key of
   width|height|top|left|margin|padding|boxShadow|filter. Allowlist by exact file:line only,
   with a reason string per entry.
3. Fix every current offender the test finds, or allowlist it with a reason. List them.
4. Add a `perf-rows` utility in globals.css: content-visibility:auto;
   contain-intrinsic-size:auto 64px. Apply it to the row component used by the family queue,
   guest list and rooming list (find them; do not guess).
5. e2e/feel-frames.spec.ts in the existing `feel` Playwright project: CDP
   Emulation.setCPUThrottlingRate 4, a PerformanceObserver for 'long-animation-frame', and
   the four gestures (tab switch, open/close a BottomSheet, scroll a 240-row list, save an
   RSVP against the fixture). Fail on any frame > 50ms. Reuse the fixtures the feel project
   already uses — read playwright.config.ts first.
Read first: docs/INTERACTION-CONTRACT.md, docs/FEEL-BASELINE.md, playwright.config.ts,
  src/app/globals.css, src/components/ui/BottomSheet.tsx, src/components/motion/MotionProvider.tsx
Files you may change: docs/INTERACTION-CONTRACT.md, tests/no-expensive-css.test.ts,
  e2e/feel-frames.spec.ts, src/app/globals.css, the offender files the test names, DECISIONS.md
Done when: the new vitest test passes, the feel spec runs (report its numbers — do not claim
  a pass you did not see), and every offender is fixed or allowlisted with a reason.
```

## C3 — Rebuild the primitives

```
[PREAMBLE]
Design source: design/arena/A0-design-system.tsx, docs/DESIGN-V4.md

TASK: Bring the shared primitives in src/components/ui to the A0 design. Same props, same
exports — every screen must keep compiling untouched. Where A0 needs a new prop, add it as
optional with the old behaviour as default.
- Button: primary indigo / secondary ink outline / quiet / destructive / `now` (haldi, ink
  text). Press = scale .97 + tint via CSS :active, duration-press. `loading` stays available
  ONLY for irreversible commits (T3) — add a JSDoc line saying so.
- Card (radius-card, 1px rule, no shadow by default), ListRow/Row (64px, avatar initials,
  meta, trailing pill, attention edge), StatusPill (the six RSVP states from A0 — "Not
  coming" is ink struck, not red), Chip (with count), Segmented, Stepper (48px buttons, mono
  number), SyncChip, UndoBar, EmptyState, ErrorState, LoadingRows (skeleton rows at the
  exact row height, no shimmer animation — a static tint is enough and costs nothing).
- NowCard: bg-now, text-now-fg, one haldi action slot.
- BottomSheet: rebuild on m.div drag="y" with the spring from §2.4, drag-to-dismiss past
  30% or velocity > 500, overscroll-behavior: contain, radius-sheet, a grab handle; focus trap
  and Escape stay. F9 applies.
- Add src/components/ui/HeroNumber.tsx (Instrument Serif, italic unit, counts up once per
  session using sessionStorage in try/catch; reduced-motion shows the final number).
Read first: every file listed above, src/components/motion/MotionProvider.tsx,
  src/lib/motion/tokens.ts, docs/DESIGN-V4.md
Files you may change: src/components/ui/{Button,Card,ListRow,Row,RowParts,StatusPill,Chip,
  Segmented,Stepper,SyncChip,UndoBar,EmptyState,ErrorState,LoadingRows,NowCard,BottomSheet,
  HeroNumber}.tsx, src/components/icons.tsx, src/app/globals.css, DECISIONS.md
Done when: /design-system (the existing route) shows every primitive in the new language,
  no call site changed, F-tests from C2 pass.
```

## C4 — One app shell; admin becomes a role, not a place

```
[PREAMBLE]
Design source: design/arena/A1-shell.tsx, design/arena/A3-control.tsx,
  UI4-ARENA-PROMPTS.md §1 and §4

TASK: Replace the two phone shells (staff and admin) with one.
1. Header: rebuild src/components/ui/ScreenHeader.tsx to A1 — event pill left (opens a
   switcher sheet built on the existing EventSwitcher data and logic; admin also sees "All
   events" → /admin/events and "New event"), search and avatar right, solid background, rule
   fades in on scroll via an IntersectionObserver sentinel (NOT a scroll listener, F6).
2. Tab bar: already reshaped by CS3 (per role, incl. the admin-only Control tab). Only
   restyle it to A1 here; do not change which tabs a role gets.
3. The (admin) layout on phones: below md, it renders inside the same header + tab bar as the
   event app (Control tab active) instead of its own "Admin" header, "App" back link and
   AdminMobileNav. At md and up it keeps AdminSidebar exactly as now. Delete AdminMobileNav
   only when nothing imports it.
4. Harvest debug leaves every nav list (src/lib/admin/nav.tsx and the old More sheet) and
   is reachable only from the version row at the bottom of Control (C5).
5. Update tests/nav-model.test.ts, tests/v3-nav.test.ts, tests/admin-nav.test.ts and
   tests/v2-route-parity.test.ts deliberately: the new contract is "every EVENT_NAV item is
   reachable from Control on a phone"; the old "reachable from More" assertion is replaced,
   not deleted. Say in DECISIONS.md which assertions changed and why.
Read first: src/app/(admin)/layout.tsx, src/app/(admin)/AdminMobileNav.tsx,
  src/app/(admin)/AdminSidebar.tsx, src/lib/admin/nav.tsx, src/lib/sections/{config.tsx,v3.ts},
  src/components/nav/{BottomTabs,EventSwitcher,AdminLink}.tsx, src/components/ui/ScreenHeader.tsx,
  the (app)/v2/[eventCode] layout, the four tests above, src/proxy.ts (how /v2 is routed)
Files you may change: all of the above except src/proxy.ts (read only), plus DECISIONS.md.
  Adding src/app/(app)/v2/[eventCode]/control/page.tsx as an EMPTY placeholder is allowed;
  C5 fills it.
Done when: on a 360px viewport an admin reaches every one of Staff, Access codes, Hotels,
  Messages, Ledger, Files, Settings from the Control tab in ONE tap; the current event is
  visible on every screen; a caller's bar is unchanged; desktop admin is unchanged.
```

## C5 — Control screen

```
[PREAMBLE]
Design source: design/arena/A3-control.tsx

TASK: Build /{eventCode}/control (the placeholder from C4) as the A3 grouped list.
- Data: reuse existing reads only — staff count (the same query admin/events/[eventCode]/page
  already runs), readHotelImportContext, live access codes, section locks
  (readSectionLocks), isArrivalsNotifyEnabled, file count, message template/log counts. Run
  them in parallel (T5). If a count has no existing read, show the row WITHOUT the value — do
  not add a query to src/lib/supabase.
- Each row links to the existing /admin/events/{code}/<page> route (now rendered inside the
  one shell on phones, per C4). Arrival alerts is an inline switch calling the existing
  action optimistically with UndoBar (T2).
- The in-list filter field filters rows client-side.
- "Archive this event" sits alone at the bottom and reuses ArchiveEventCard's logic.
- The version row reads /api/version; long-press (500ms, pointer events, no library) opens
  /debug where Harvest debug now lives.
- The amber "No staff names yet" row moves here from the old admin dashboard.
- Non-admin hitting the route gets the existing denied handling (src/lib/sections/denied.ts).
Read first: design/arena/A3-control.tsx, src/app/(admin)/admin/events/[eventCode]/page.tsx,
  .../settings/page.tsx, .../settings/*.tsx, .../ArchiveEventCard.tsx,
  src/lib/actions/{section-locks,arrivals,import-hotels}.ts, src/lib/sections/denied.ts
Files you may change: src/app/(app)/v2/[eventCode]/control/**, the matching (staff) route if
  the parity test requires one, src/app/(admin)/admin/events/[eventCode]/page.tsx (remove
  what moved), DECISIONS.md
Done when: every admin tool is one tap from Control, the page paints its frame from cache on
  tab return (T4), and it passes the C2 frame test.
```

## C6 — Admin detail screens: codes, staff, events + new-event wizard

```
[PREAMBLE]
Design source: design/arena/A3-control.tsx (codes detail), A4-events.tsx, A5-staff.tsx

TASK: Restyle and re-flow codes/, staff/ and events/ (+ CreateEventForm) to the A-winners.
Keep every server action call exactly as it is; change layout, interaction and state only.
- Codes: masked values, Reveal (still writes code_reveal_log through the existing action),
  Copy, Rotate with the single plain confirm sheet — rotation ends live sessions
  (CLAUDE.md §10), so it is an irreversible-for-users action and MAY use Button loading.
- Staff: inline add row, department segmented filter, swipe row actions implemented with
  m.div drag="x" + dragConstraints (transform only), remove-blocked explanation.
- Events: card list with archived collapsed; the wizard in a full-height BottomSheet, 3 steps,
  optimistic insertion of the new row; keep router.prefetch of the destination (A7).
Read first: the three A files, src/app/(admin)/admin/events/{page.tsx,CreateEventForm.tsx},
  .../[eventCode]/codes/*, .../[eventCode]/staff/*
Files you may change: those route folders, DECISIONS.md
Done when: create event, add staff, reveal and rotate a code all work on a 360px phone with no
  horizontal scroll, reversible writes are optimistic, rotate confirms once.
```

## C7 — Admin detail screens: messages, hotels & rooms, files, ledger, settings

```
[PREAMBLE]
Design source: design/arena/A6-messages.tsx, A7-hotels.tsx

TASK: Same approach as C6 for messages/ (send, templates, log — as one screen with a
Segmented control; keep the three sub-routes working as deep links), hotels/ (+ rooms,
new, import-hotels with warnings-before-write preview), files/, ledger/, settings/.
Send progress continues if the user navigates away: hold it in a react-query mutation cache
entry, not component state. Do not change any action's server logic.
Read first: the two A files and the listed route folders under
  src/app/(admin)/admin/events/[eventCode]/
Files you may change: those route folders, DECISIONS.md
Done when: every admin page matches the language, no page has a table wider than 360px (turn
  tables into row lists on phones), and the old "Msgs" wording is gone everywhere.
```

## C8 — Today

```
[PREAMBLE]
Design source: design/arena/A2-today.tsx

TASK: Rebuild the Today screen ((app)/v2/[eventCode]/page.tsx and its _home components) to
A2: HeroNumber on a NowCard, the five bucket tiles (reuse src/lib/rsvp-buckets.ts and the
v_event_rsvp_buckets read — do not add a query), the "Needs you" list (reuse AttentionPanel's
sources; rank by urgency; calm-day single line), and today's arrivals timeline (reuse the
arrivals read). Every number links to its list (R4). Remove the explanatory paragraphs.
Read first: design/arena/A2-today.tsx, the Today page and _home folder, src/lib/rsvp-buckets.ts,
  src/components/dashboard/*
Files you may change: (app)/v2/[eventCode]/page.tsx, (app)/v2/[eventCode]/_home/**,
  src/components/dashboard/**, DECISIONS.md
Done when: the busy, calm, empty and offline states all render; the hero counts once per
  session; the frame test passes on tab return.
```

## C9 — Calls: queue, call screen, outcome logging

```
[PREAMBLE]
Design source: design/arena/A8-calls.tsx, A9-call-screen.tsx

TASK: Restyle rsvp/queue (CallNext, CurrentFamilyCard, FamilyQueueSheet), the call screen
(src/components/call/CallScreen.tsx and rsvp/call/[groupId]) and the outcome form
(rsvp/status/[groupId]/RsvpLogForm.tsx) to A8/A9.
NON-NEGOTIABLE, from CLAUDE.md — do not change these behaviours, only their look:
- The call_attempts row is written BEFORE the dial fires; its id lives in sessionStorage;
  the flow is resume-first (§12). Dial goes through openExternalUrl (§12), never window.open.
- The call screen does NOT claim or release the lock; the status screen claims on open and
  releases after a successful save (§6).
- Outcome is written once; the row freezes (§5.4).
- The RECORDING indicator in A9 is DISPLAY ONLY in this session: bind it to whatever
  recording state the existing code already exposes. If no such state exists, render the
  "add a voice note" variant and leave a clearly named TODO for the recording series. Do NOT
  touch the recorder, CallPlugin, or capacitor-voice-recorder wiring.
- Make the save optimistic per T2/T5: show the tick and UndoBar immediately; the release
  runs after save, off the tap path; move to the next family after 1.2s.
Read first: the two A files, rsvp/queue/*, src/components/call/CallScreen.tsx,
  rsvp/status/[groupId]/*, src/lib/rsvp-queue.ts, CLAUDE.md §5.4 §6 §12
Files you may change: those folders/files (UI only), DECISIONS.md
Done when: a full call → outcome → next family loop runs on a handset with no spinner on
  Save, the lock-held state shows holder and release time, and the four NON-NEGOTIABLES are
  verified by reading the diff back.
```

## C10 — Review screen

```
[PREAMBLE]
Design source: design/arena/A10-review.tsx

TASK: Restyle rsvp/review and review/[extractionId] (src/components/review/*) to A10.
apply_rsvp_extraction() stays the only write path (§5.8, §9). Low confidence (< 0.8) renders
amber with "Check this". Tapping a field scrolls the transcript to its source sentence with
scrollIntoView({block:'center'}) — no custom scroll animation. Audio scrubber moves by
transform. Nothing auto-saves.
Read first: design/arena/A10-review.tsx, rsvp/review/**, src/components/review/**, CLAUDE.md §9
Files you may change: those, DECISIONS.md
Done when: the payload sent to the RPC is byte-identical to before for the same input (show a
  test or a logged comparison), and the screen matches A10.
```

## C11 — Find anything

```
[PREAMBLE]
Design source: design/arena/A11-find.tsx

TASK: Rebuild (app)/v2/[eventCode]/find to A11 as a full-screen sheet opened from the header.
Local-first: search the react-query cache / Dexie data the app already holds, then the
existing server search, merging without a spinner. Add "Tools" results for admins, generated
from src/lib/admin/nav.tsx so it never drifts. Gujarati-script matching must work.
Read first: design/arena/A11-find.tsx, the find route, docs/guest-search-explain.md,
  src/lib/query/keys.ts, src/lib/admin/nav.tsx
Files you may change: the find route folder, src/components/ui/ScreenHeader.tsx (open
  behaviour only), DECISIONS.md
Done when: typing a name, last 4 digits of a phone, a room number or a flight number all
  return results within one frame of the keystroke from cache.
```

## C12 — Hospitality: rooms, check-in, hampers, proof

```
[PREAMBLE]
Design source: design/arena/A12-rooms.tsx, A13-checkin-proof.tsx

TASK: Restyle hospitality (rooms board, allocate, rooming list, check-in, deliveries) and the
hamper run to A12/A13, with Rooms · Check-in · Hampers as one Segmented control for
management (from C4).
- Keep RoomsGridClient's react-query cache and the select-then-place flow. Swap 23514
  handling: when both rooms are full, show the "empty one room first" sheet, NOT the override
  sheet (this is the known gap in CLAUDE.md §14 — fix it here, UI only).
- Proof: delivery_proofs are insert-only (§5.2). "Confirm delivery" confirms once and waits
  (Button loading allowed). The seal animation: transform + opacity only.
- The capture button must NOT use Button loading (T3 — it is not a commit).
Read first: the two A files, hospitality/**, hamper/**, RoomsGridClient.tsx, RoomsBoard.tsx,
  DeliveryDetail.tsx, CLAUDE.md §5.2 §10 §14
Files you may change: those route folders and their _components, DECISIONS.md
Done when: place, move, undo, over-capacity override, swap-blocked, check-in all, and a sealed
  proof all work on a handset; the rooms board scrolls at 60fps with 148 rooms under ×4 CPU.
```

## C13 — Logistics

```
[PREAMBLE]
Design source: design/arena/A14-logistics.tsx

TASK: Restyle logistics (arrivals, departures, trips, fleet, sheets) to A14. One fleet per
event, shared by both directions — do not split it (§6). Vehicle suggestion stays advisory.
Capacity shown luggage-adjusted. seats_used is trigger-maintained; never write it.
Read first: the A file, logistics/**, src/components/fleet/**, CLAUDE.md §6
Files you may change: those, DECISIONS.md
Done when: the arrivals day view, a trip, and the fleet list match A14 and pass the frame test.
```

## C14 — Sign-in, pick-staff, client view, failure screens

```
[PREAMBLE]
Design source: design/arena/A15-client.tsx, A16-entry.tsx

TASK: Restyle (auth)/login, (auth)/admin/login, pick-staff, the client (family) view,
global-error.tsx (inline hex — see C1), ErrorState/EmptyState usage, public/offline.html and
the update-required prompt to A15/A16. Cookie and storage key names are FROZEN (§12). The
sign-in gradient is the only gradient in the app. public/offline.html cannot load fonts or
tokens — inline its styles and say so in a comment.
Read first: the two A files, those routes/files, src/lib/auth/cookies.ts (read only)
Files you may change: those routes/files, DECISIONS.md
Done when: a cold start → code → pick name → Today flow matches A16 on a handset, and a
  revoked code shows the plain "code was changed" message.
```

## C15 — The verification pass

```
[PREAMBLE]
Design source: UI4-ARENA-PROMPTS.md §3, docs/DESIGN-V4.md

TASK: No new features. Prove the series.
1. Run the C2 feel-frames spec and record numbers per gesture in docs/FEEL-BASELINE.md
   (append a dated section; before vs after if the old numbers exist).
2. Run npm run latency and npm run bundle-size; record both. Flag any route whose first-load
   JS grew by more than 15% against the last recorded baseline.
3. Grep audit, reporting counts: backdrop, transition-all, hardcoded hex outside
   global-error/offline.html, `<Button loading` on reversible writes, router.refresh() on
   screens touched by this series.
4. Write docs/HANDSET-TEST.md steps for the §14 round: the four F10 gestures, the admin
   one-tap-to-every-tool check, a full call loop, a sealed proof, offline save — with a
   pass/fail column left EMPTY for the human to fill.
Files you may change: docs/FEEL-BASELINE.md, docs/HANDSET-TEST.md, DECISIONS.md
Done when: every number above is reported as measured, or marked NOT MEASURED with the
  reason. Nothing is claimed that was not run.
```

---

## Order of play

```
PHASE 1 — STRUCTURE (the skeleton; no restyling yet)
  Read Part S → AF1…AF6 (arena, pick winners) → CS0 → CS1 → CS2 → CS3 → CS4 → CS5
  → CS6 → CS7 → CS8 → CS9
PHASE 2 — LOOK + PERFORMANCE FLOOR
  A0 → C0 → C1 → C2 → C3
PHASE 3 — THE ONE SHELL + CONTROL (the admin complaint, finished)
  A1 + A3 → C4 → C5
PHASE 4 — SCREENS, on the new routes
  A4 A5 → C6,  A6 A7 → C7,  A2 → C8,  A8 A9 → C9,  A10 → C10,  A11 → C11,
  A12 A13 → C12,  A14 → C13,  A15 A16 → C14
PHASE 5 — PROVE IT
  C15 (frames, bundle, latency) + re-run CS9 (taps) → hand over to the recording series
```

Why structure first: every C prompt restyles a screen at a URL. Restyling `rsvp/status`
and then merging it into `families/[id]/call` a week later is paying for the same screen
twice. Phase 1 uses today's components as they are, so it is cheap and fully testable
before a single pixel changes.

Save every arena winner as `design/arena/<id>-<name>.tsx` and commit them — they are the
design record, like the migrations are the schema record. When neither arena model wins
outright, take the better *layout* and the better *motion* and say so in DECISIONS.md; do not
ask a C session to merge two prototypes.

---

## Next series (not in this file): call recording debug

Deliberately out of scope here, so no UI session can touch it by accident. C9 leaves the
recording indicator display-only with a named TODO. The recording series starts from
`call-recording-harvest-prompts.md` and `call-intelligence-plan.md`, and its first step is
evidence, not code: one real team handset, its Android version and OEM, a `adb logcat`
capture of one full call with the recorder, and whether a file appears at all. CLAUDE.md §13.1
says Android 13+ recording is untested and is the one open question that can change the shape
of Phase 1 — answer that before writing a line.
