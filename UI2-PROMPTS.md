# EventFlow — "Instant & Obvious" UI/UX Rebuild (V0–V12)

**Supersedes `docs/UX-PROMPTS.md` (P0–P9).** That series treated the problem as wording and
navigation. It was half right: P0 shipped the rules, P1 deduped the routes, and the app is
*still* hard for a non-technical runner — because the two biggest causes were never on its
list. This series fixes those two, then rebuilds the screens on top.

For **Command Code / a Flash-class model** against `C:\dev\EventFlow`.
One prompt per session. Commit between each. Do not merge two prompts into one session.

**Free-rebuild conditions:** the 26 Aug 2026 event is done. No staff are on handsets, so
these prompts may touch the shell, the nav and the data layer. They still must not write
migrations — that stays your call, not an agent's.

---

## 1. What is actually wrong, verified in the code today

The complaint is "it feels built for developers." That splits into two mechanical causes and
one cosmetic one. Every row below was checked against the tree, not guessed.

### Cause A — every tap waits for Seoul

| Evidence | Where | What it does to a runner |
|---|---|---|
| **`useOptimistic`: zero occurrences in `src/`** | whole tree | No button in this app ever changes state on the tap. Every one waits for a server round trip first. |
| **`Button` has a `loading` prop that swaps the icon for a `Spinner` and sets `disabled`** | `src/components/ui/Button.tsx` | The commit control goes *dead and spinning* for the length of a network call. This is the single thing the user is describing as "delay on every button". |
| **23 files carry local `saving` / `pending` / `busy` state** | `src/app`, `src/components` | Twenty-three separate hand-rolled blocking spinners. |
| **The RSVP save is three sequential network hops for one tap** | `rsvp/status/[groupId]/RsvpLogForm.tsx` — `setSaving(true)` L175 → `await saveRsvpLog` L176 → `await releaseGroupAfterCall` L204 → `router.push` L225/228 | Tap "Save", wait for hop 1, wait for hop 2, then wait for hop 3 to render the next screen. Three round trips before anything moves. |
| **TanStack Query is installed and used in exactly ONE file** | `@tanstack/react-query` in `package.json`; only consumer is `hospitality/rooms/RoomsGridClient.tsx` | ~75 routes have no client cache. Going back to a list you were on two seconds ago re-fetches it from Seoul. |
| **`router.refresh()` is the mutation pattern — 10 call sites** | 9 files incl. `CallScreen.tsx`, `StaffPicker.tsx` | A full server re-render round trip to show a change the client already knows about. |
| **`revalidatePath`: 50 call sites** | `src/lib/actions/*` | Same, from the server side. |
| **`prefetch=` appears nowhere in `src/`** | whole tree | Tab taps and list-row taps start from cold every time. |
| **Every screen is an `async` server component awaiting Supabase** | e.g. `(staff)/[eventCode]/page.tsx` | 28 `loading.tsx` files means you get a skeleton fast and the *content* slowly. A skeleton is not a screen. |
| **Layout and page each resolve the event separately** | `(staff)/[eventCode]/layout.tsx` — its own comment says "the per-page gate resolves it again inside each page" | Two identity resolutions per navigation. |
| **Functions run in Seoul (`icn1`), users are in Surat** | `vercel.json`; CLAUDE.md §3 records deployed guest-list timings of **7.4s and 9.9s against a 5s budget** | Already measured, already over budget, already written down. |
| **Remote-shell APK has no local bundle** | CLAUDE.md §11c | Network is a hard dependency, not a degradation. Every one of the above costs double at a venue. |

**The conclusion that matters:** this is not a slow database. It is a UI that refuses to
move until the database answers. Nothing above needs a schema change to fix.

### Cause B — the screens are organised by system, not by job

| Evidence | Where | What it does to a runner |
|---|---|---|
| **Home leads with six counters** | `(staff)/[eventCode]/page.tsx` — headline figure, split bar, then 6 `StatCard`s, then 4 links | A runner opening the app needs "what do I do next". `AttentionPanel` is above them now, which is right, but it renders nothing on a calm day and then the screen is pure scoreboard again. |
| **Two navigation rows render before any content** | `layout.tsx` → `SectionTabs` inside the column, `BottomTabs` fixed | On a 360px phone the work starts below two bars and a welcome banner. |
| **The app explains itself in body copy on the screen** | Home ends with a paragraph about reading counters from the database; Rooms says *"Capacity is enforced by the database, not this screen"*; Arrivals says *"Expected today first, then later dates."* | This is release-note prose aimed at a reviewer. A runner reads it as instructions they are failing to follow. |
| **Filter stacks before content** | Arrivals: 3 counters + search + 3 toggle chips + 5 mode chips **with a visible horizontal scrollbar**. Queue: progress + 4 status chips (scrollbar) + a Side select + 2 more toggles. | Five controls to configure before seeing one family. |
| **Abstract room grid** | Rooms: numbered tiles + dots, legend of 5 states | Nothing on it is a person's name. |
| **No "find anyone" box** | no `(staff)/[eventCode]/find` route; search is reimplemented inside 8 screens | The first instinct of every new user — type a name — has nowhere to go. |
| **No undo anywhere except the rooms grid** | no `src/components/ui/UndoBar.tsx` | Reversible actions feel as scary as irreversible ones, so people freeze. |
| **`MoreSheet` is gone, so off-tab screens are dashboard links only** | deleted; Home carries 4 hardcoded links | Check-in, Departures, Export are reachable only from Home. |

### Cause C — the ground is light, but the re-skin did not finish

**THE APP IS A LIGHT APP. Every prompt in this series is a light-tone prompt.** There is no
dark mode, no OS following, and no dark ground anywhere. `:root` in `src/app/globals.css`
sets `color-scheme: light` and `--ef-paper: #f8f9fa` (warm ivory); the client skin under
`[data-theme='client']` is warm cream `#f4efe4`. Both grounds are light. The accent is gold
`#735c00`, the text is deep charcoal `#191c1d`. That is the whole palette.

**Do not re-skin this app.** globals.css is a real token system: two light grounds via
`data-theme`, every text pair annotated with a measured WCAG ratio, one motion ease family,
`figure`/`eyebrow` utilities, a documented colour rule (gold = accent, emerald = COMPLETED,
signal = ATTENTION, never decorative). Tailwind v4 CSS-first — **there is no
`tailwind.config.js` and there must not be one.** Every prompt below builds *on* those
tokens. Introducing a new colour, font, hardcoded hex or second radius scale is a failed
session.

**But the ground changed and four things did not follow it.** The app was a dark teal night
palette (`#071A1D` + champagne brass) before the Royal Ivory re-skin. globals.css says the
re-skin was cheap because "every component reads these names" — and it was, *for colour*.
**Shadows were never tokenised**, so they never re-skinned, and neither did anything written
with an inline hex. What is still dark, verified today:

| Dark artifact | Where | Why it is wrong on ivory |
|---|---|---|
| **A fully dark error screen** | `src/app/global-error.tsx` L42–85: `background:'#071A1D'`, `color:'#EDF3F2'`, muted `#8FA9AE`, button `#C9A96B` on `#071A1D` | Inline styles, so tokens never reached it. The app fails to boot and the user gets a black-teal screen — the only dark screen in a light app, at the worst moment. |
| **85%-black drop shadows on every card** | `src/components/ui/Card.tsx:37` and `(staff)/[eventCode]/page.tsx:198` — `rgba(0,0,0,0.85)`; `src/components/ui/BottomSheet.tsx:75` — `rgba(0,0,0,0.8)` | `DESIGN.md` specifies "extra-diffused shadows with a 2%–4% opacity, tinted with the primary charcoal". These are **20× that opacity and pure black**. On ivory they read as a hard dirty-grey drop — this is what makes the light theme look muddy and heavy. |
| **Brass *glows*, built for a dark plane** | `src/components/ui/Button.tsx:39` `shadow-brand/70`, whose own comment says *"a brass glow rather than a black drop: on a #071A1D ground a black shadow is invisible"*; `DeliveryDetail.tsx:406` `shadow-[0_0_46px_-10px]` | A 70% gold glow under the primary button is a dark-UI device. On a light ground it is a smear. |
| **A brass + verdigris wash on the sign-in screen** | `src/app/(auth)/layout.tsx` — `rgba(201,169,107,0.17)` and `rgba(79,193,160,0.07)` over `bg-paper`, commented *"over the flat night teal"* | Atmospheric on teal; on ivory it is a beige smudge and a green tint. |

**And nine files still tell a reader the app is dark.** `(staff)/[eventCode]/layout.tsx:82`
*"Staff get the night-teal ground they work on in corridors and car parks"*, plus
`Card.tsx:9`, `Field.tsx:73`, `PageTitle.tsx:28`, `ErrorState.tsx:47`, `(auth)/layout.tsx:7`
and both `GuestCard.tsx` copies. **This is a live trap for this series:** the preamble tells
the model to keep every comment, and CLAUDE.md says comments record why — so a model reading
"the night ground" will design dark. V0b fixes the comments for exactly this reason.

**What is already correct — do not touch it.** The whole native launch chain is light and
was deliberately fixed: `capacitor.config.ts` StatusBar `style:'LIGHT'` + `#f8f9fa`,
`android/app/src/main/res/values/colors.xml` (all `#f8f9fa`/`#f3f4f5`/`#735c00`),
`styles.xml` `windowSplashScreenBackground`, `layout.tsx` `themeColor:'#f8f9fa'`,
`public/offline.html` and `public/install.html`. `colors.xml` carries a comment explaining
that the dark values there caused "a dark flash swapping to light one frame into every
launch". That fix is done. The same job inside `src/` is not.

One more thing in globals.css is evidence for this series: it ends with a
`@media (pointer: coarse)` block disabling `list-fade`, `grow-x`, `push-in` and `sheet-in`
on phones, commented *"read as the screen zooming or jumping"*. The instinct was correct.
V0 turns it into a rule.

---

## 2. The strategy, and why it is not "edit the 76 routes"

**The new UI is built as a new route group, behind a flag, screen by screen.**

```
src/app/(app)/[eventCode]/...      <- new, task-first, the V-series builds this
src/app/(staff)/[eventCode]/...    <- existing, untouched, still works
src/lib/actions/*                  <- shared by both, NOT modified except where V5 says
```

A `proxy.ts` rule sends a session to one or the other on `NEXT_PUBLIC_UI`. Three reasons,
and the third is the one that matters for a Flash-class model:

1. The old app keeps working while the new one is half-built. No session ever ends with a
   broken tree.
2. Each session's work is revertible by deleting one folder.
3. **The model creates files instead of editing 76 existing ones.** In-place rewriting
   across a large tree is precisely where this model class drifts, and the previous series
   found that out the expensive way.

The server actions in `src/lib/actions/` are good, tested, and enforce nothing the UI needs
to re-enforce (RLS is the fence — CLAUDE.md §5). The new UI calls exactly the same ones.

---

## 3. Paste this preamble at the top of every prompt

The model starts each session cold. Without the frame it invents its own conventions.

```
You are working in C:\dev\EventFlow — a Next.js 16 / React 19 / Supabase / Capacitor app
for running Indian wedding guest operations on cheap Android phones over bad venue Wi-Fi.
It is used by non-technical staff who get no training. The APK is a remote shell over the
deployed site, so there is no local bundle and every network hop is felt.

Before you write any code:
1. Read CLAUDE.md sections 5, 7, 12 and 14. They are house rules, not suggestions.
2. Read docs/UX-RULES.md, docs/GLOSSARY.md and docs/INTERACTION-CONTRACT.md.
   Every change must satisfy all three.
3. Read only the files listed in "Read first" below. Do not explore the whole repo.

Hard limits for this session:
- Change ONLY the files listed in "Files you may change". If the task seems to need a file
  that is not on that list, STOP and report which file and why. Do not change it.
- Do NOT write or run database migrations. Do NOT touch supabase/, src/lib/supabase/, or
  anything to do with RLS. If you need data the database does not expose, STOP and report
  exactly which column, view or RPC is missing.
- Do NOT add npm dependencies. Everything you need is already installed — check
  package.json before claiming otherwise.
- Do NOT create tailwind.config.js. Tailwind v4 here is CSS-first; the tokens live in
  src/app/globals.css.
- THIS IS A LIGHT APP. The ground is warm ivory (#f8f9fa) for staff and warm cream
  (#f4efe4) for the family view; text is deep charcoal, the accent is gold. There is no
  dark mode and nothing follows the OS. Do NOT add a dark ground, a dark surface, a
  `prefers-color-scheme` rule, a `.dark` class, or a light-on-dark panel "for contrast".
  Some comments in this repo still describe a dark teal "night ground" from an earlier
  design — that palette is GONE. The tokens in globals.css are the truth, not the prose.
- Do NOT invent colours, fonts, radii or easings. Use the existing tokens
  (bg-paper, bg-surface, text-ink, text-muted, text-brand, ledger-green, ledger-red,
  duration-press, ease-ledger, the `figure` and `eyebrow` utilities). A hardcoded hex in
  your diff is a failed session.
- Shadows come from the `shadow-e1` / `shadow-e2` / `shadow-e3` tokens (V0b adds them).
  Never write an arbitrary `shadow-[...]`, and never a black shadow — on a light ground
  elevation is charcoal-tinted at 2–4% opacity, per DESIGN.md.
- Do NOT reformat, re-indent or "tidy" code you are not changing. Keep every existing
  comment — the comments in this repo record why things are the way they are.
- Mobile-first: 16px base, tap targets >= 44px, one 480px column, no horizontal scroll
  at 360px.

When you are done:
- Run `npm run typecheck`. It must pass clean.
- Run `npx eslint <the files you changed>`. Those files must be clean. Do NOT run
  repo-wide `npm run lint` and do not report its number — it exits 1 on a clean tree
  (~273 pre-existing errors, CLAUDE.md §3), so it proves nothing.
- Run `npm run test:run`. All 133 tests must still pass.
- Show me `git diff --stat`.
- Append what you changed and why to DECISIONS.md. Do not rewrite the file.
- Tell me in plain words: what can a runner now do, or now feel, that they could not before.
```

**After every session:** commit, then open the app on a real handset (`npm run mobile:dev`)
— CLAUDE.md §14. A green typecheck is not a verified change.

---

# V0 — Write down what "instant" means

*No app code. This produces the file every later prompt is graded against. The old series
had UX-RULES.md but nothing about time, which is why nothing about time got fixed.*

```
[PREAMBLE — but skip step 2's INTERACTION-CONTRACT.md, you are creating it now]

TASK: Create docs/INTERACTION-CONTRACT.md. No changes to any file under src/.

This app's UX rules (docs/UX-RULES.md, R1-R8) cover words, targets and dead ends. They say
nothing about time, and "it feels laggy" is the loudest complaint about the product. This
file is the missing half. Later sessions will be judged against it, so write it as
checkable rules, not advice.

Read these first and quote real numbers and real file paths from them — do not write
generic performance advice:
  src/app/globals.css          (the motion tokens, and the `pointer: coarse` block at the end)
  src/components/ui/Button.tsx (the `loading` prop)
  src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx (the save flow)
  src/lib/perf.ts              (traceFetch, and how timing is already recorded)
  CLAUDE.md §3 (the Seoul region and the 7.4s / 9.9s guest-list measurements) and §11c

WRITE THESE SEVEN RULES, each with: one paragraph of why, a measurable pass condition, and
a right/wrong example naming a real file in this repo.

  T1. The tap owns the first 100ms.
      Every tappable control shows a visible state change within 100ms of touchstart,
      from local state only — never after a network call. Pass condition: no control's
      first visual response is behind an `await`.

  T2. A write shows its result before the server confirms it.
      Reversible writes update the screen immediately and reconcile when the server
      answers. If the server disagrees, the screen corrects itself and says so. Pass
      condition: no reversible write blocks the UI on a round trip. The exception is
      sealing a delivery proof (insert-only, CLAUDE.md §5.2) — that one waits, and says
      it is waiting.

  T3. A disabled button is a bug unless the input is invalid.
      `loading`-with-spinner on a commit button is banned for reversible writes: it kills
      the only control the user has, for the length of the worst network in the building.
      Pass condition: `<Button loading>` appears only on irreversible commits.

  T4. Navigation is instant or it is not navigation.
      Tapping a tab or a list row paints the destination's frame — header, title, the
      rows you already have — within 100ms, from cache. Only genuinely new data may
      arrive later, and it arrives into a laid-out screen, never into a spinner.
      Pass condition: no route transition shows a full-screen loading state for data the
      client already had.

  T5. One tap is one round trip, at most.
      A single user action may not chain sequential server calls. If an action needs two
      writes, they go in parallel, or into one action, or the second happens in the
      background after the screen has moved. Pass condition: no handler contains two
      awaited network calls in sequence.

  T6. Motion is confirmation, never transition.
      Animation may confirm something happened (the seal stamping down). It may not sit
      between a tap and its result. Everything on the press path uses duration-press
      (100ms) and nothing else. Pass condition: the `pointer: coarse` block in globals.css
      stops being necessary, because nothing on a phone animates layout on navigation.

  T7. Offline is a state, not an error.
      Every write says honestly which of three things happened: saved, saved on this
      phone, or not saved. Reuse src/components/ui/SyncChip.tsx. Pass condition: no write
      path can reach a silent success or an indefinite spinner.

THEN add a section "Budgets" with a table of the numbers V1 will measure and V12 will
enforce. Propose them from what you read, and mark each as PROPOSED so I can set them:
tap-to-visual-feedback, tap-to-destination-frame, tap-to-content for a cached list,
tap-to-content for an uncached list, and one action's total server time.

FINALLY add a section "The six states every screen must have", listing them with the
existing component that serves each: first load, empty, has-content, content-plus-pending
write, load failure, offline. Name the real component for each — most already exist in
src/components/ui (EmptyState, ErrorState, LoadingRows, SyncChip, OfflineBanner). Say which
of the six has NO component yet.

Read first:
  docs/UX-RULES.md
  src/app/globals.css
  src/components/ui/Button.tsx
  src/components/ui/SyncChip.tsx
  src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx
  src/lib/perf.ts
  CLAUDE.md §3, §11c

Files you may change: docs/INTERACTION-CONTRACT.md, DECISIONS.md. Nothing else.

Done when: the file exists, all seven rules have a measurable pass condition, every example
names a file that really exists, the Budgets table is present with PROPOSED markers, and
`git status` shows nothing changed under src/.
```

---

# V0b — Finish the light ground

*Cheap, mechanical, and it must come before any new screen is built. V6 and V7 will copy
whatever elevation and comments they find — so fix them here, once, rather than propagating
a dark-UI artifact into every new screen.*

```
[PREAMBLE]

TASK: The app was a dark teal night palette (#071A1D + champagne brass) before the Royal
Ivory & Gold re-skin. The colour tokens re-skinned. Shadows, inline styles and code
comments did not. Finish the job.

Read section 1, "Cause C" of docs/UI2-PROMPTS.md before you start — it lists every artifact
with a file and a line number. Do not go hunting for more than it names, and do not
"improve" anything outside the four parts below.

PART A — Tokenise elevation. This is the root cause, so do it first.
globals.css has tokens for colour, motion, type, radius and spacing — and NONE for shadow.
All seven shadows in the app are arbitrary `shadow-[...]` values, which is exactly why the
dark-ground ones survived a re-skin that the comment at the top of globals.css calls cheap
"because every component reads these names". Shadows read no name.

  1. Add three shadow tokens to the `@theme inline` block in src/app/globals.css, built on
     the existing charcoal `--ef-ink` (#191c1d) rather than black, at the opacity DESIGN.md
     actually specifies — "extra-diffused shadows with a 2%-4% opacity, tinted with the
     primary charcoal color. Shadows should feel like a soft glow rather than a hard drop":
       --shadow-e1  a hairline lift: a resting card, a list row
       --shadow-e2  a raised surface: the headline panel, a popover
       --shadow-e3  an overlay: the bottom sheet
     Define each as a two-layer shadow (a tight contact shadow plus a diffuse one), keep
     every layer within the 2-4% band, and comment each with what it is for. Define them
     for BOTH grounds — the client ground's ink is #1b2426, so if a single charcoal serves
     both, say so; if not, redefine them under [data-theme='client'] like every other token.
  2. Replace every arbitrary shadow with the matching token:
       src/components/ui/Card.tsx:37                    rgba(0,0,0,0.85)  -> shadow-e1
       src/app/(staff)/[eventCode]/page.tsx:198          rgba(0,0,0,0.85)  -> shadow-e2
       src/components/ui/BottomSheet.tsx:75              rgba(0,0,0,0.8)   -> shadow-e3
                                                         (keep it directional — it lifts
                                                          upward from the bottom edge)
       src/components/ui/Button.tsx:39                   shadow-brand/70   -> see part B
       .../deliveries/[deliverableId]/DeliveryDetail.tsx:406  the 46px glow -> see part B
       src/app/(staff)/[eventCode]/guests/list/_components/GuestCard.tsx:77
       src/app/(staff)/[eventCode]/guests/_components/GuestCard.tsx:73
         Both already use a charcoal tint, rgba(27,36,38,0.28) — closest to correct in the
         app, and still 7x the specified opacity. Point them at shadow-e1 too.
  3. Add a test, tests/no-arbitrary-shadows.test.ts: fail if any .tsx under src/ contains
     `shadow-[`. This is what stops the drift coming back, and it is the only reason
     tokenising is worth doing at all.

PART B — The two glows. Both are dark-UI devices: on #071A1D a black shadow is invisible,
so the design used coloured light instead. On ivory a 70% gold glow under a button is a
smear.
  - Button.tsx primary: remove the brass glow, give it shadow-e1. Then FIX ITS COMMENT,
    which currently reads "Brass on the ground with dark type - 8:1 ... a brass glow rather
    than a black drop: on a #071A1D ground a black shadow is invisible." Two things in it
    are false now: the variant paints `text-brand-fg`, which is WHITE (#ffffff), not dark
    type; and the ground is not #071A1D. Rewrite it to describe what the code does, and
    keep the part that is still true and load-bearing — that this is the only solid gold
    fill in the app, so "the commit" is never ambiguous.
  - DeliveryDetail.tsx:406: this is the seal moment, the one flourish in the app
    (globals.css `seal-in`, "the single moment worth a flourish, because it is the one
    action that can never be undone"). Keep the flourish. Change the glow to something that
    reads on a light ground — the emerald COMPLETED tint rather than a light bloom. Do not
    remove the animation and do not touch the proof capture logic.

PART C — global-error.tsx. The only genuinely dark screen left, and it is what a user sees
when the app fails to boot: background #071A1D, text #EDF3F2, muted #8FA9AE, button #C9A96B
on #071A1D.
  - Repaint it in the light palette using the same hex values as the tokens: ground
    #f8f9fa, text #191c1d, muted #4d4635, button #735c00 with #ffffff text.
  - The hexes stay INLINE and that is correct, not a shortcut — global-error replaces the
    root layout, so no stylesheet and no token is available to it. Add a comment saying
    exactly that, and saying these five values must be kept in step with `:root` in
    globals.css. A future reader will otherwise "fix" them back into classes that render
    nothing.
  - Check the contrast of the pair you choose and put the ratio in the comment, the way
    globals.css annotates every other pair. #4d4635 on #f8f9fa is 8.9:1 per those notes.
  - Leave the copy alone. "The app failed before it could draw anything. Reload, and if it
    keeps happening send your admin the reference below." is the house voice and R6 cites
    that voice as the standard.

PART D — The nine lying comments. These matter more than they look, because the preamble
tells you to keep every comment and CLAUDE.md says comments record why. A future session
reading "the night ground" will design dark.
  Rewrite each to describe the LIGHT ground, keeping whatever reasoning in it is still
  true — several explain a real decision (why a field is a lifted well, why a title needs
  tracking on a cheap LCD) and only the ground is wrong:
    src/app/(staff)/[eventCode]/layout.tsx:82   "Staff get the night-teal ground they work
                                                 on in corridors and car parks"
    src/components/ui/Card.tsx:9                "a card on the night ground"
    src/components/ui/Field.tsx:73              "on the night..."
    src/components/ui/PageTitle.tsx:28          "on a night ground on a cheap LCD"
    src/components/ui/ErrorState.tsx:47         "in signal red on the night"
    src/app/(auth)/layout.tsx:7                 "over the flat night teal"
    src/app/(staff)/[eventCode]/guests/list/_components/GuestCard.tsx:29
    src/app/(staff)/[eventCode]/guests/_components/GuestCard.tsx:27
      Both say the client card sits "on warm paper rather than the night ground". Half
      right: the contrast they describe is now cream vs ivory, not cream vs teal.
  Then grep src/ for "night", "teal", "071A1D" and "C9A96B" and show me that the only
  survivors are the historical note in globals.css (lines 28-38, which deliberately records
  what the ground USED to be and how to revert) and this series' own docs. Do not delete
  that note — it is the documented revert path.

PART E — The sign-in wash, src/app/(auth)/layout.tsx. Brass at 17% and verdigris at 7% over
ivory is a beige smudge and a green tint; verdigris is not in the light palette at all.
Keep the intent — this is the one screen in the app allowed a gradient, because "sign-in is
the one moment nobody is working" — and re-express it in the light palette: a single very
soft gold wash off the `--ef-brand-tint` token, and drop the verdigris entirely. One
gradient, not two. Update the comment.

DO NOT: change any layout, spacing, radius, font or copy; touch capacitor.config.ts,
android/, public/offline.html, public/install.html or scripts/brand-assets.mjs — the native
launch chain is ALREADY light and correct, and colors.xml carries a comment explaining that
the dark values there caused a dark flash on every launch; add a dark mode; add a
dependency; create tailwind.config.js; delete the historical palette note in globals.css.

Read first:
  src/app/globals.css  (the header comment, :root, [data-theme='client'], @theme inline)
  DESIGN.md            ("Elevation & Depth" — the 2-4% rule you are implementing)
  src/components/ui/Card.tsx, Button.tsx, BottomSheet.tsx
  src/app/global-error.tsx
  src/app/(auth)/layout.tsx
  android/app/src/main/res/values/colors.xml  (read only — the precedent for this fix)

Files you may change: src/app/globals.css, src/app/global-error.tsx,
src/app/(auth)/layout.tsx, src/components/ui/{Card,Button,BottomSheet,Field,PageTitle,
ErrorState}.tsx, both GuestCard.tsx files, src/app/(staff)/[eventCode]/layout.tsx and
page.tsx (shadow + comment only), the DeliveryDetail glow line,
tests/no-arbitrary-shadows.test.ts (new), DECISIONS.md. Nothing else.

Done when: `grep -rn "shadow-\[" src --include=*.tsx` returns nothing and the new test
enforces it; no `rgba(0,0,0` anywhere in src/; no dark ground on any screen including the
boot-failure screen; grep for "night"/"teal"/"071A1D" survives only in the globals.css
historical note; the three shadow tokens are defined for both grounds and sit inside the
2-4% band; typecheck and tests pass; screenshot /design-system at 390px before and after
and show me both — nothing in it should get darker, several things should get lighter.
```

---

# V1 — Measure it before touching it

*Second, not later. Without a baseline, every prompt after this is an opinion.*

```
[PREAMBLE]

TASK: Build a harness that measures what a runner actually waits for, and record today's
numbers as the baseline. Change no product code.

WHY THIS SHAPE: this repo has already been burnt three times measuring the wrong thing —
DECISIONS.md, 2026-08-09, records that TTFB and browser `load` both lied because 28
`loading.tsx` files mean every route streams a shell instantly while the data is still
coming. e2e/measure-routes.mjs was the fix for server time. It is not enough now, because
the complaint is about taps, not page loads.

BUILD e2e/feel.spec.ts, under the existing `phone` Playwright project (read
playwright.config.ts and e2e/t2_offline.spec.ts for the house pattern). Seed exactly as
`npm run test:acceptance` does: e2e/fixtures/generate.mjs then scripts/seed-543.mjs.

Measure these five, each as a named metric, each reported in ms:

  M1 tap -> first visual change    click a bottom tab; time until ANY pixel in the tab bar
                                   or the main column changes. Use a MutationObserver or
                                   requestAnimationFrame sampling installed before the tap.
  M2 tap -> destination frame      same tap; time until the destination's header and
                                   section strip are painted (a stable selector that is not
                                   the skeleton).
  M3 tap -> real content           same tap; time until the first real row renders, not a
                                   LoadingRows placeholder. Assert you are distinguishing
                                   the two — a test that cannot tell a skeleton from a row
                                   measures nothing.
  M4 commit -> screen moved        on the RSVP log screen, tap Save; time until the screen
                                   shows the outcome. Record the number of network requests
                                   that fire between the tap and the move.
  M5 back -> list restored         drill into a family, go back; time until the list is
                                   interactive again, and whether it re-fetched.

Run each over these routes, 5 iterations, report median and worst:
  /{event}  ·  /{event}/rsvp/queue  ·  /{event}/guests/list
  /{event}/hospitality/rooms  ·  /{event}/logistics/arrivals

Also record, per route: number of network requests, and total bytes.

THEN throttle and repeat. Playwright CDP can emulate network conditions — use a
"venue Wi-Fi" profile (300ms RTT, 1.5Mbps down) and a "4G" profile (150ms RTT, 4Mbps).
The unthrottled number on a dev laptop is the least interesting one; the whole point is
what a phone at a hotel feels.

WRITE the results to docs/FEEL-BASELINE.md as a table, with the date, the commit SHA
(`git rev-parse HEAD`), the throttle profile, and one plain-English paragraph per route
saying what a runner experiences. Then fill in the Budgets table in
docs/INTERACTION-CONTRACT.md with real numbers taken from this run — replace each PROPOSED
marker with a budget that is achievable but strictly better than today, and say in one line
why you chose it.

DO NOT: change any file under src/, add a dependency, or "fix" anything you find. If a
metric cannot be measured with the installed Playwright version, STOP and report which one
and why — do not substitute a proxy metric without saying so.

Add one npm script: "test:feel".

Read first:
  playwright.config.ts
  e2e/t2_offline.spec.ts
  e2e/measure-routes.mjs
  e2e/fixtures/generate.mjs
  scripts/seed-543.mjs
  docs/INTERACTION-CONTRACT.md

Files you may change: e2e/feel.spec.ts (new), docs/FEEL-BASELINE.md (new), the Budgets
table in docs/INTERACTION-CONTRACT.md, package.json (one script), DECISIONS.md.
Nothing under src/.

Done when: `npm run test:feel` prints all five metrics for all five routes at two throttle
profiles; docs/FEEL-BASELINE.md records them against a commit SHA; the Budgets table has
real numbers; nothing under src/ changed.
```

---

# V2 — A client cache, so the app remembers what it just showed you

```
[PREAMBLE]

TASK: Put every list and detail read behind the TanStack Query cache that is already
installed, so returning to a screen is instant and a re-render is not a re-fetch.

THE STATE TODAY, verified: @tanstack/react-query is a dependency,
src/components/providers/QueryProvider.tsx exists, and exactly ONE file in the whole app
uses it — src/app/(staff)/[eventCode]/hospitality/rooms/RoomsGridClient.tsx. Every other
screen reads on the server on every navigation, against Supabase in Seoul.

SCOPE THIS SESSION: the read layer only. No optimistic writes (that is V3), no new screens
(that is V6+). Do not restructure any server action.

BUILD:
1. src/lib/query/keys.ts — one factory for every cache key in the app, so no two call
   sites can disagree. Shape them hierarchically and event-scoped:
   ['event', eventId, 'families', filters] / ['event', eventId, 'family', groupId] /
   ['event', eventId, 'rooms'] / ['event', eventId, 'arrivals', day] and so on.
   EVERY key starts with the event id. A key that is not event-scoped is a tenancy bug
   waiting to happen — the same browser can hold two events (EventSwitcher).

2. src/lib/query/reads.ts — a thin typed wrapper per read, calling the EXISTING server
   action from src/lib/actions/. Do not rewrite a single action. If an action returns a
   shape that is awkward to cache, wrap it; do not change it.

3. Set the defaults in QueryProvider.tsx deliberately, with a comment on each:
   staleTime 30s (matching the TTL cache already in src/lib/actions/dashboard.ts),
   gcTime 15 minutes, refetchOnWindowFocus FALSE — critical: `tel:` backgrounds the
   WebView on every single call (CLAUDE.md §12), so focus refetch would re-fetch the
   whole screen after every dial. retry 2 with exponential backoff, and retry: false for
   anything already known to be offline (src/lib/useOnline.ts exists).

4. Add a server-side hydration boundary so the first paint is still server-rendered and
   the client takes over with a warm cache — no double fetch on first load. Use the
   standard dehydrate/HydrationBoundary pattern. Verify with the network panel that the
   first load fires ONE request for a given read, not two.

5. Convert exactly THREE screens this session, as proof, and stop:
   guests/list, rsvp/queue, logistics/arrivals. Leave every other screen alone. These
   three are the highest-traffic lists and they already have client components to hold
   the hook.

6. Add tests/query-keys.test.ts: assert every key factory output starts with
   ['event', <id>], and that no two factories can produce the same key for different data.

DO NOT: touch src/lib/supabase/, change any server action's signature, add a dependency,
delete a loading.tsx, or convert a fourth screen. If a read cannot be expressed without
changing its action, STOP and report which one.

Read first:
  src/components/providers/QueryProvider.tsx
  src/app/(staff)/[eventCode]/hospitality/rooms/RoomsGridClient.tsx  (the existing pattern)
  src/app/(staff)/[eventCode]/guests/list/GuestsClient.tsx
  src/lib/actions/dashboard.ts  (the 30s TTL cache, and why it exists)
  src/lib/ttl-cache.ts
  src/lib/useOnline.ts
  docs/INTERACTION-CONTRACT.md  (T4, T5)

Files you may change: src/lib/query/* (new), src/components/providers/QueryProvider.tsx,
the client components of the three named screens, tests/query-keys.test.ts (new),
DECISIONS.md. Nothing else.

Done when: `npm run test:feel` shows M5 (back -> list restored) under the budget with zero
re-fetch on all three converted screens; first load fires one request per read, not two;
the other screens are byte-identical; typecheck and tests pass.
```

---

# V3 — No button waits for the network

*The single highest-impact session in the series. This is the one the user is asking for.*

```
[PREAMBLE]

TASK: Make every reversible write take effect on the screen at the moment of the tap, and
reconcile with the server afterwards.

THE STATE TODAY, verified: `useOptimistic` appears ZERO times in src/. 23 files hand-roll
a local `saving` flag. src/components/ui/Button.tsx has a `loading` prop that replaces the
leading icon with a Spinner AND sets `disabled` — so the commit control on a field screen
goes dead and spins for the length of the worst network in the building. That is the
"delay on every button" the product is being judged on.

BUILD, in this order:

1. src/components/ui/UndoBar.tsx — does not exist yet, and optimistic writes need it.
   A bar sitting above the bottom tabs (use the existing `bottom-nav` utility in
   globals.css, which already clears the tab bar and the gesture bar). One message, one
   Undo control >= 44px. Auto-commits after 7 seconds; dismiss on tap commits immediately;
   a second action commits the first and replaces it. aria-live="polite". One at a time.

2. src/lib/mutate/useOptimisticAction.ts — ONE hook every write goes through, so the
   pattern cannot drift across 23 files. It must do all of:
   - apply the change to the TanStack cache immediately (V2's keys) and return at once
   - fire the server action in the background
   - on success, reconcile the cache with what the server returned
   - on failure, roll the cache back AND surface the real reason using the existing
     error voice (src/components/ui/ErrorState.tsx, src/lib/errors.ts) — never a silent
     revert, which reads as the app randomly undoing the user's work
   - report its state through the existing src/components/ui/SyncChip.tsx vocabulary:
     saved on this phone / sending / saved
   - when offline (src/lib/useOnline.ts), queue rather than fail, following the pattern
     already in src/lib/proof-queue.ts. Do not build a second queue — read that file and
     reuse its shape.

3. Apply it to these reversible writes and no others this session:
   - setting an RSVP outcome (src/lib/actions/rsvp.ts)
   - marking a family checked in or out (src/lib/actions/rooms.ts)
   - assigning or moving a guest between rooms (src/lib/actions/rooms.ts)
   - assigning a vehicle to an arrival (src/lib/actions/logistics.ts)
   Each one: the row changes on the tap, an UndoBar appears, and Undo actually reverses
   the write. If a write has no reverse available in src/lib/actions/, STOP and list it
   rather than faking an undo that only hides the message.

4. Amend Button.tsx: keep the `loading` prop (V4 and the proof-sealing path still need
   it) but add a comment above it stating it is for IRREVERSIBLE commits only, and name
   the one screen that may use it. Do not change its visual design.

5. NOT optimistic, deliberately, and say so in your DECISIONS.md entry: sealing a
   delivery proof. CLAUDE.md §5.2 — delivery_proofs is insert-only with
   app.block_mutation() triggers on update and delete, so not even the service role can
   remove one. That action keeps its confirmation, keeps `loading`, and its confirmation
   text must say plainly that it cannot be undone.

DO NOT: convert a write that is not on the list in step 3; change any server action's
behaviour or signature; write a migration; add a dependency; build a toast library.

Read first:
  src/lib/proof-queue.ts            (the existing offline queue shape — reuse it)
  src/components/ui/SyncChip.tsx
  src/components/ui/Button.tsx
  src/lib/errors.ts
  src/lib/actions/rsvp.ts, rooms.ts, logistics.ts  (the four writes only)
  src/lib/query/keys.ts             (from V2)
  docs/INTERACTION-CONTRACT.md      (T1, T2, T3, T7)

Files you may change: src/components/ui/UndoBar.tsx (new), src/lib/mutate/* (new),
src/components/ui/Button.tsx (comment only), and the client components of the four writes
in step 3. Nothing under src/lib/supabase, no migrations, no new server actions.

Done when: each of the four writes changes the screen inside 100ms of the tap with no
network wait; Undo reverses each one for real; a failed write rolls back and explains
itself in the existing error voice; airplane mode queues instead of failing; sealing a
proof still warns and still cannot be undone; M4 in `npm run test:feel` is under budget;
typecheck and tests pass; all four tested on a real handset, including one with Wi-Fi off.
```

---

# V4 — Navigation that has already happened

```
[PREAMBLE]

TASK: Make tapping a tab or a list row paint the destination immediately, from what the
client already knows, with only genuinely new data arriving afterwards.

THE STATE TODAY, verified: `prefetch=` appears nowhere in src/. There are 28 loading.tsx
files, so every navigation currently means: tap -> skeleton -> wait for Seoul -> content.
A skeleton arriving in 40ms does not make the app feel fast; it makes the wait visible.

BUILD:
1. Prefetch the five bottom tabs. src/components/nav/BottomTabs.tsx already renders
   next/link — add explicit prefetch, and warm the destination's query cache (V2) on
   pointerdown/touchstart, not on hover: these are touch devices and there is no hover.
   Five tabs is a bounded, known set, so this is a fixed cost, not a fan-out.

2. Prefetch the row under the thumb. In the three converted lists (guests/list,
   rsvp/queue, logistics/arrivals), warm the detail query for a row on touchstart. The
   gap between touchstart and the tap completing is free latency — use it.
   Bound it: at most 3 in-flight prefetches, cancel on scroll. An unbounded prefetch on
   a 238-row list is a self-inflicted denial of service on venue Wi-Fi.

3. Replace skeleton-first with frame-first on those three lists. When the cache holds
   the list, render it immediately and mark it stale; do not render LoadingRows over data
   you have. LoadingRows stays for the genuinely cold first load only.

4. Keep the shell mounted across navigation. StickyHeader, SectionTabs and BottomTabs
   must not unmount and remount on a route change within an event — check whether they
   currently do, report what you find, and fix it only if the fix is inside the files
   listed below. If it requires restructuring the layout, STOP and report: that belongs
   to V6, which builds the new shell.

5. Kill the double identity resolution on the hot path, IF you can do it without touching
   a guard. src/app/(staff)/[eventCode]/layout.tsx carries a comment saying the per-page
   gate resolves the event again inside each page. src/lib/request-cache.ts exists for
   exactly this and its own comment records that it does NOT dedupe across the
   layout/page boundary. Read both. If the fix is a wider cache, do it. If the fix
   requires changing a guard's behaviour, STOP AND REPORT — do not weaken a guard to save
   a round trip. That trade is explicitly forbidden (DECISIONS.md, 2026-08-09).

DO NOT: prefetch every row in a list; prefetch across events; add a dependency; remove a
loading.tsx file; change what any guard permits.

Read first:
  src/components/nav/BottomTabs.tsx
  src/components/nav/SectionTabs.tsx
  src/app/(staff)/[eventCode]/layout.tsx  (the whole file, including the comments)
  src/lib/request-cache.ts                (both its purpose and its documented limit)
  src/lib/query/keys.ts                   (from V2)
  docs/INTERACTION-CONTRACT.md            (T4, T6)

Files you may change: src/components/nav/*, the three converted list client components,
src/lib/request-cache.ts, src/lib/query/*, DECISIONS.md. Nothing under src/lib/auth or
src/lib/supabase.

Done when: M1 and M2 in `npm run test:feel` are under budget on all five routes at the
venue-Wi-Fi throttle; a cached list never shows a skeleton; prefetch is bounded at 3 and
cancels on scroll; no guard changed; typecheck and tests pass; tested on a handset.
```

---

# V5 — One tap, one round trip

```
[PREAMBLE]

TASK: Remove every place where one user action chains sequential server calls.

THE WORST ONE, verified, and the reason this prompt exists:
src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx does this for one tap
on Save —
  L175  setSaving(true)
  L176  await saveRsvpLog(...)                 <- network hop 1
  L204  await releaseGroupAfterCall(...)       <- network hop 2, sequential
  L225  router.push('/{event}/rsvp/next')      <- hop 3, renders the next screen
Three round trips to Seoul, in series, with a dead spinning button in front of them. On
the measured deployed numbers (CLAUDE.md §3: 7.4s and 9.9s for a route) that is a
multi-second wait after the most frequent action in the entire product.

STEPS:
1. Find every instance. Grep for a handler containing two or more `await` calls that each
   hit the network, and list them with file and line before changing anything. Show me
   the list.

2. Fix each by one of these three, in order of preference, and say which you used:
   (a) Make it one call. The RSVP case is the clearest: saving an outcome and releasing
       the caller's lock are one logical act. Check whether saveRsvpLog can release the
       lock itself — read src/lib/actions/rsvp.ts and the claim/release RPCs first. If
       the release belongs server-side, that is the fix, and it removes a whole hop.
       NOTE THE CONSTRAINT: release must still only ever be done by the lock holder.
       `release_group`'s `or app.is_admin()` branch was deliberately removed by migration
       20260813000000 (CLAUDE.md §11b) — do not reintroduce an admin bypass, and do not
       write a migration. If this needs a server-side change you cannot make in
       src/lib/actions/, STOP and report exactly what.
   (b) Run them in parallel with Promise.all, where neither depends on the other's result.
   (c) Move the second one off the tap path: the screen advances on the first result and
       the second runs in the background, with its failure surfaced honestly rather than
       swallowed.

3. Make the navigation not be a round trip. `router.push` to a server-rendered screen is
   a fourth wait. With V2's cache and V4's prefetch, the next screen's data should already
   be warm — prefetch the next-family route while the caller is still on the call screen.
   It is the most predictable navigation in the app: after logging an outcome, the next
   family is always what comes next.

4. RESUME-FIRST IS NOT NEGOTIABLE. CLAUDE.md §12 and PRODUCT.md principle 4: the
   call_attempts row is written with started_at BEFORE the dial fires, its id lives in
   sessionStorage, and the flow rehydrates on resume because `tel:` backgrounds the
   WebView and Android may discard page state. Also §5.4: the row freezes permanently the
   moment `outcome` goes non-null, and it is append-only — a wrong write cannot be tidied
   up afterwards, by anyone. Do not make the outcome write optimistic. Do not batch it.
   Do not let it fire twice. State in your report how you verified it still fires exactly
   once per attempt.

DO NOT: write a migration; change an RPC; make the call_attempts outcome write optimistic;
touch src/lib/supabase/.

Read first:
  src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx  (whole file)
  src/lib/actions/rsvp.ts
  src/lib/actions/call.ts
  src/lib/native-call.ts
  CLAUDE.md §5 rule 4, §6 (the caller lock bullet), §11b, §12
  docs/INTERACTION-CONTRACT.md (T5)

Files you may change: the RSVP log form and call screen client components, src/lib/rsvp.ts,
src/lib/rsvp-log.ts, and src/lib/actions/rsvp.ts / call.ts ONLY where the change is to
combine or parallelise existing calls. No migrations, nothing under src/lib/supabase.

Done when: no handler in the app awaits two network calls in sequence — show me the grep
proving it; the RSVP save moves the screen in one round trip; the caller lock still
releases and still only by its holder; the call_attempts row still writes once, before the
dial, and still freezes on outcome; M4 under budget; typecheck and tests pass; the full
dial -> log -> next-family loop tested on a real handset with a SIM.
```

---

# V6 — A new shell, built around the job

*The first prompt that creates a screen. Everything before it made the app fast; this one
starts making it obvious.*

```
[PREAMBLE]

TASK: Create the new route group and its shell, plus the new home screen. Do not convert
any existing screen — this session builds the frame and one screen inside it.

WHY A NEW GROUP: the existing (staff) group stays working while the new UI is built.
Read section 2 of docs/UI2-PROMPTS.md before you start — the strategy is not optional.

BUILD:
1. The flag. src/lib/ui-version.ts — reads NEXT_PUBLIC_UI ('v1' default, 'v2' new).
   One function, typed, no `any`. Then add a rule in src/proxy.ts sending an event-scoped
   path to /(app)/... or /(staff)/... accordingly.
   CAREFUL: src/proxy.ts is Next 16's renamed middleware and is Node-runtime only —
   CLAUDE.md §3 records that setting runtime:'edge' there fails the build and that this
   is what blocks the Cloudflare path. Do not add a runtime export. Do not restructure
   updateSession(). Add your rule alongside what is there.

2. src/app/(app)/[eventCode]/layout.tsx — the new shell. Same guards as the existing one
   (read it and copy the guard logic exactly; a new shell with a weaker guard is a
   security regression, and getEventByCode returning null must still mean 404).
   Differences from the old shell, and these are the point:
   - ONE navigation row, not two. The old shell renders SectionTabs inside the column AND
     BottomTabs fixed, so work starts below two bars on a 360px screen. The new shell has
     the bottom bar only; second-level navigation lives inside the screen that needs it.
   - The header carries the screen's name and its back control, not the event name. The
     event name belongs on the home screen; a runner three screens deep needs to know
     where they are, not which wedding it is.
   - A search control in the header on every screen (the destination is V8's; wire the
     control now, pointing at /(app)/{event}/find, and it can 404 until V8 lands — say so
     in your report).
   - No welcome banner in the shell. StaffWelcomeBanner is a per-session greeting sitting
     permanently above every screen's content; if it is worth showing it belongs on home.

3. src/app/(app)/[eventCode]/page.tsx — the new home. It answers ONE question: what do I
   do next. Top to bottom, and nothing else:
   - "Right now": up to three job cards, worst first, from the non-zero attention numbers
     readBoard() already returns (confirmedNoRoom, arrivalsNoVehicle, noDeparture,
     hampersPending). Each card is one sentence naming the job and its count, and ONE
     button going straight to where the job gets done. 56px tall button (size="lg").
   - If every attention number is zero: one calm line, "Nothing needs you right now."
     No empty cards.
   - "Today": three figures on one row — arriving today, leaving today, hampers left —
     each linking to its filtered list.
   - The headline guests figure and its split bar, moved to the bottom. Reuse the existing
     markup from (staff)/[eventCode]/page.tsx; do not redesign it.
   - DELETE the closing paragraph explaining that counters are read from the database.
     That is a release note, not a screen. Same for any other sentence on the screen that
     explains how the app works rather than what to do.
   - Keep the zero-guests empty state from the old home exactly as written. It is the best
     copy in the app and docs/UX-RULES.md R3 cites it as the model.

4. Add no database read. Everything above is in readBoard()'s existing payload. If a
   number you need is not in it, STOP and report which one — do not add a query.

5. Route both /(app)/{event} and the tab bar through V2's cache and V4's prefetch. The new
   shell must inherit the fast path, not start from cold.

DO NOT: delete or edit anything under src/app/(staff)/; write a migration; change a guard's
behaviour; add a dependency; create a second set of UI primitives — import from
src/components/ui as-is.

Read first:
  src/app/(staff)/[eventCode]/layout.tsx  (whole file, all comments — copy the guards)
  src/app/(staff)/[eventCode]/page.tsx    (whole file — the empty state and the split bar)
  src/components/dashboard/AttentionPanel.tsx
  src/lib/actions/dashboard.ts
  src/lib/sections/config.tsx
  src/proxy.ts
  docs/UX-RULES.md (R1, R3, R4), docs/INTERACTION-CONTRACT.md

Files you may change: src/app/(app)/** (new), src/lib/ui-version.ts (new), src/proxy.ts
(additive only), DECISIONS.md. Nothing under src/app/(staff), nothing under src/lib/supabase.

Done when: NEXT_PUBLIC_UI=v2 lands on the new home and NEXT_PUBLIC_UI=v1 is unchanged from
today; the first thing on screen is a job with a button; no sentence on the screen explains
the database; the guards are provably identical to the old shell's (show me the comparison);
one nav row, not two; typecheck and tests pass; tested on a handset at 360px.
```

---

# V7 — The four field jobs, one screen each

*The biggest session. If it feels too wide, split it by job — four sessions, one job each,
is the correct fallback and is better than one drifting session.*

```
[PREAMBLE]

TASK: Build the four things staff actually do, as four single-purpose screens in the new
route group. Each is ONE job, done in the fewest taps, with no configuration first.

THE FOUR JOBS, and what is wrong with today's version of each:

  1. CALL THE NEXT FAMILY.
     Today: rsvp/queue opens with a progress bar, four status chips in a horizontally
     scrolling strip, a Side dropdown, and two more toggle buttons — five controls before
     one family is visible. Then rsvp/status/[groupId] is a separate screen, and the save
     was three round trips (V5 fixed that).
     New: /(app)/{event}/call opens on ONE family — the next one to call — with their name,
     their number, how many guests, and a 56px Call button. Logging the outcome happens on
     the same screen, under the dial, as five one-tap outcomes (Confirmed / Declined /
     No answer / Call back / Wrong number). After saving, the next family is already there.
     Filters exist behind one "Choose who to call" control, not in front of the work.

  2. GIVE A FAMILY A ROOM.
     Today: hospitality/rooms is a grid of numbered tiles with dots and a five-state
     legend. Nothing on it is a person's name, and the screen explains itself in a
     footnote about database capacity enforcement.
     New: /(app)/{event}/rooms leads with the families who need a room, by name, each with
     a "Give a room" button. The room grid becomes the second step of that flow — pick a
     family, then pick a room — not the entry point. Keep every guard the existing grid
     has (the overlap and capacity triggers raise 23514 and the UI must handle it — see
     V10 for the swap case).

  3. DELIVER A HAMPER.
     Today: hospitality/deliveries then [deliverableId]. docs/UX-RULES.md R1 already names
     this screen as the app's best example — do not redesign the proof capture.
     New: /(app)/{event}/hampers is a list of families still owed something, by name, each
     row one tap from the camera. Carry the existing DeliveryDetail proof flow across
     unchanged, including its confirmation and its `loading` button — that write is
     irreversible and must stay that way (CLAUDE.md §5.2).

  4. MEET AN ARRIVAL.
     Today: logistics/arrivals opens with three counters, a search box, three toggle chips
     and five mode chips in a scrolling strip, above an empty state.
     New: /(app)/{event}/arrivals leads with who lands next, in time order, each row
     showing name, time, and what they need (pickup or not). One tap marks them arrived.
     Mode filters go behind one control.

RULES FOR ALL FOUR:
- Every one of the four is reachable in ONE tap from the new home's bottom bar.
- No screen may show more than one row of filter controls, and never before content.
  If a filter set does not fit one row, it goes behind a single control that opens a sheet
  (src/components/ui/BottomSheet.tsx exists — use it).
- No horizontal scrollbar at 360px, anywhere. SectionTabs and the arrivals chip row have
  both had this bug before; their comments record it.
- Every row shows a PERSON'S NAME first. A row whose family name is missing shows the head
  of the family or the phone number — never a raw id. Today's queue renders group ids like
  "A0-VERIFY-mshqvcsx" when a name is absent, which is what "built for developers" looks
  like on a screen.
- Reuse the existing primitives: ListRow, StatusPill, Badge, EmptyState, BottomSheet,
  SyncChip, UndoBar (V3). Create no new primitive without saying why in your report.
- Every write goes through V3's useOptimisticAction. No new blocking spinner.
- Delete no screen in (staff). This group is additive.

DO NOT: write a migration; change a server action's behaviour; add a dependency; redesign
the delivery proof capture; build a fifth screen.

Read first (per job, only the ones you need):
  src/app/(staff)/[eventCode]/rsvp/queue/*  and  rsvp/status/[groupId]/*
  src/app/(staff)/[eventCode]/hospitality/rooms/RoomsGridClient.tsx
  src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx
  src/app/(staff)/[eventCode]/logistics/arrivals/*
  src/components/ui/BottomSheet.tsx, ListRow.tsx, StatusPill.tsx
  src/lib/mutate/useOptimisticAction.ts  (from V3)
  docs/UX-RULES.md, docs/GLOSSARY.md, docs/INTERACTION-CONTRACT.md

Files you may change: src/app/(app)/** (new), DECISIONS.md. Nothing under src/app/(staff),
nothing under src/lib except importing from it.

Done when: each of the four jobs is done from a cold app in the tap budget V12 will assert;
no screen shows a filter before content; no horizontal scroll at 360px; no row renders a
raw id; all four tested on a real handset, and the hamper one tested with the camera.
```

---

# V8 — One box that finds anyone

```
[PREAMBLE]

TASK: Build the search the header in V6 already points at.

THE PROBLEM: search is reimplemented inside eight screens — GuestsClient, ArrivalsClient,
CheckInClient, DeparturesClient, DeparturesBoard, ClientGuestList and the rooms grid — and
exists nowhere as a front door. The first instinct of every new user is to type a name, and
there is nowhere to type it.

BUILD /(app)/{eventCode}/find:
1. A full screen, not a dropdown. One autofocused input. On a cheap handset a full screen
   is faster to hit and far easier to read than a popover.
2. Results as you type: 250ms debounce, minimum 2 characters, and the results list is
   never replaced by a spinner — stale results stay visible and dim while new ones load
   (INTERACTION-CONTRACT T4).
3. Match on: guest name, family head name, mobile number INCLUDING the last 4 digits only
   (staff know the last four, never the whole number), and room number.
4. Each result row: name, family, room number, RSVP status, arrival day — in that order.
   Reuse ListRow and StatusPill. Do not invent a row style.
5. Roles. Staff and admin use the same source guests/list already uses. A client uses
   client_guest_profiles exactly as ClientGuestList does. READ THIS BEFORE YOU WIRE IT:
   `search_guest_profiles` runs as the invoker and returns NOTHING to a client, and
   `v_event_board` returns a row of ZEROS to a client rather than zero rows — the long
   comment in (staff)/[eventCode]/page.tsx explains the trap. A client result row must
   never link anywhere staff-only.
6. States: empty query -> a hint line naming what can be searched. No results -> say what
   was searched and offer the full guest list. Offline -> say search needs signal and offer
   the last-loaded list from V2's cache. Never a blank screen.

DO NOT: add a search index or dependency; write SQL; create a view. If last-4-digit
matching is not possible with the existing RPC, STOP and report exactly what is missing —
do not pull a full table to the client and filter it there. That is 465 guests over venue
Wi-Fi.

Read first:
  src/app/(staff)/[eventCode]/guests/list/GuestsClient.tsx
  src/app/(staff)/[eventCode]/guests/list/_components/ClientGuestList.tsx
  src/app/(staff)/[eventCode]/page.tsx  (the requireStaff / zeros comment)
  src/lib/actions/search-guests.ts
  src/lib/phone.ts
  src/components/ui/ListRow.tsx

Files you may change: src/app/(app)/[eventCode]/find/** (new), src/lib/query/* (add the
search key), DECISIONS.md. Nothing else.

Done when: from any screen in the new UI, two taps and three letters find a family; a
client can search their own list and cannot reach a staff screen from a result; typing
never blanks the results; offline says so and still shows the cached list; typecheck and
tests pass; tested on a handset.
```

---

# V9 — Say it the way a guest would, and say less of it

*Copy and density only. Zero logic. Do not let this become a refactor.*

```
[PREAMBLE]

TASK: Two passes over the NEW route group only: plain words, then delete the explanations.

PASS 1 — WORDS. Replace every trade term a user reads with the plain word from
docs/GLOSSARY.md. That table already exists and already names the real files.
  - You may change only strings a user reads: JSX text, label=, title=, placeholder=,
    aria-label=, description=, metadata titles.
  - You may NOT rename a variable, prop, type, function, column, route segment or file.
    `pax` stays `pax` in the code and reads "guests" on screen.
  - You may NOT change a string used as a key, status value, enum, query param, or
    anything compared with ===. If you cannot be certain a string is display-only, leave
    it and list it in your report.
  - Excel headers in src/lib/export/ keep the client's own vocabulary, PAX included. Their
    existing sheets must still line up. Do not touch that folder.
  - Every button label becomes verb + object, and must make sense with the rest of the
    screen covered up. "Submit" -> "Save room". "Confirm" -> "Mark hamper delivered".

PASS 2 — DENSITY. This is the pass that has never been run, and it is why the app reads as
developer-facing. Delete, from the new screens:
  - Every sentence that explains how the app works instead of what to do. Real examples
    to remove, verbatim, from the screens you carry across:
      "Counters read live from the database on every visit. A zero means nothing has been
       recorded yet..."           (home)
      "Capacity is enforced by the database, not this screen. Going over needs a written
       reason, and the reason is kept."   (rooms)
      "Expected today first, then later dates."   (arrivals)
    These are true, well written, and aimed at a code reviewer. A runner reads them as
    instructions they are failing to follow.
  - Every counter that is not a door. docs/UX-RULES.md R4 is already the rule; apply it as
    a deletion, not an addition — a number nobody can tap is a number nobody needs.
  - Every label that duplicates its value's meaning. "GUESTS ROOMED 0 / have an active
    room assignment" is one fact written three times.
  - Any eyebrow label above a single item.

WHAT TO KEEP, and do not "improve" it:
  - The error and empty-state voice. It is honest, it says who to ask, and R6 cites it.
  - Every code comment. They record why, and this repo's comments are load-bearing.
  - Devanagari-inline rendering of family names. Names come off the sheet in Hindi
    ("शर्मा परिवार") on the same row as Latin, and globals.css loads the Plex Devanagari
    cut deliberately for it. Do not change a font stack.

THEN: append to docs/GLOSSARY.md any trade term you found in the new screens that is not
already in the table, with the file it appeared in.

DO NOT: touch src/app/(staff)/; touch src/lib/export/; rename anything; change a font,
colour or radius; write marketing copy.

Read first:
  docs/GLOSSARY.md, docs/UX-RULES.md (R2, R4, R6)
  src/components/ui/EmptyState.tsx, ErrorState.tsx, ErrorReference.tsx
  every file under src/app/(app)/

Files you may change: any .tsx under src/app/(app)/, docs/GLOSSARY.md, DECISIONS.md.
Nothing else.

Done when: `git diff` contains no renamed identifier — every changed line is a string a
user reads or a line deleted; grep the new group for "pax", "deliverable", "extraction",
"unmatched", "harvest", "leg", "roomed" in JSX text and show me that the only survivors are
code identifiers; no screen in the new group contains a sentence about the database;
typecheck and tests pass.
```

---

# V10 — Make a wrong tap cheap, and stop offering the dangerous option

```
[PREAMBLE]

TASK: Two specific fixes. Both are recorded as live product defects in CLAUDE.md.

PART A — The room swap trap. CLAUDE.md §14 records it under "Known product gap".
Swapping two full rooms (a1,a2 in A; b1,b2 in B; capacity 2 each) raises Postgres 23514,
because the intermediate state is always over capacity —
app.guard_room_capacity() counts active assignments and the count hits 4 against a cap of
2. src/lib/actions/rooms.ts catches 23514 in four places and the UI answers by offering the
capacity OVERRIDE sheet, which would force a genuine over-capacity commit. The app is
suggesting the dangerous option to someone who does not know better.
  - Detect the swap case: the failing move's target room is full AND the selected occupants
    all come from one other room.
  - In that case do not offer override at all. Say: "Room B is full. Move its guests out
    first, then bring these two in." One button that moves B's occupants to unplaced, after
    which the original move retries automatically.
  - Genuine over-capacity (an extra mattress, not a swap) keeps the override sheet exactly
    as it is — it is legitimate, and it requires a written reason that is kept.
  - Do the same for the overlap guard, app.guard_room_overlap(), which also raises 23514
    (migration 20260805140000). A date-range collision is a different problem from a
    capacity collision and must not share an error message. Distinguish them — read the
    trigger's message text, do not guess from the code alone.

PART B — Apply the UndoBar from V3 across the whole new group, and remove every
confirmation dialog on a reversible action. The rule is docs/UX-RULES.md R5: undo, do not
confirm.
  - Reversible, gets undo, no dialog: room assign/move, vehicle assign, RSVP outcome,
    check in/out, marking an arrival arrived.
  - Irreversible, keeps its dialog and its `loading` button, and its text must say plainly
    that it cannot be undone: sealing a delivery proof. CLAUDE.md §5.2 —
    app.block_mutation() triggers on update and delete mean not even the service role can
    remove one.
  - There is one more thing that cannot be undone and currently says nothing about it:
    a call_attempts row freezes permanently the moment `outcome` goes non-null (§5.4,
    app.guard_call_attempt stamps finalized_at and identity columns are force-restored on
    every update). Logging an RSVP outcome is therefore NOT reversible at the database
    level, however reversible it looks. Decide which it is and say so on the screen —
    either the outcome commits on a delay with a real undo window before the write fires,
    or it commits immediately and the screen says it is final. Do not show an Undo that
    cannot undo. Report which you chose and why.

PART C — The stuck caller lock. CLAUDE.md §11b: a caller's phone dying mid-RSVP leaves a
family uneditable for 15 minutes with NO manual override, and "no admin UI lists locked
families, so discovery is one family at a time, by walking into it." You cannot fix the
override (that needs a new RPC and a migration — yours, not an agent's). You CAN fix the
discovery half: the new call screen must show, on a locked family, who holds it and the
exact clear time ("releases automatically by 21:47"), and the family list must mark a
locked row as locked rather than looking normal. §11b notes the queue's presence label
("Ravi, 2 min ago") is presence, not lock state — do not use it as one.

DO NOT: write a migration; add or change an RPC; restore any admin bypass to
release_group; touch src/lib/supabase/.

Read first:
  src/app/(staff)/[eventCode]/hospitality/rooms/RoomsGridClient.tsx
  src/lib/actions/rooms.ts  (the four 23514 handlers)
  src/lib/errors.ts
  src/components/ui/UndoBar.tsx  (from V3)
  CLAUDE.md §5 rules 2 and 4, §6 (caller lock), §10 (the room guards), §11b, §14

Files you may change: src/app/(app)/**, src/lib/mutate/*, src/lib/errors.ts, DECISIONS.md.
src/lib/actions/rooms.ts ONLY to distinguish the two 23514 causes in what it returns —
not to change what it does.

Done when: a two-full-room swap offers "empty one room first" and never offers override;
a genuine over-capacity still offers override with its written reason; an overlap error
reads differently from a capacity error; every reversible action has undo and no dialog;
sealing a proof still warns; the RSVP outcome's true reversibility is stated on screen and
matches the database; a locked family shows its holder and clear time; typecheck and tests
pass; both room paths tested on a handset.
```

---

# V11 — Teach on the screen, in under a minute

```
[PREAMBLE]

TASK: Nobody trains these users. The app teaches itself, in place, or not at all.

src/components/motion/WelcomeOverlay.tsx already exists and is not used as onboarding.
Reuse it. Do not build a second overlay.

BUILD:
1. First run, once per device — three swipeable cards, skippable from the first.
   Team: "Your next job is on the home screen" / "Find anyone in two taps" / "Everything
   you tap is saved, even with no signal".
   Store the flag with @capacitor/preferences, the mechanism src/lib/native already uses —
   NOT localStorage, which a WebView remount can lose. Never show it twice, never block
   the app behind it.
2. A "?" control in the header opening ONE cheat-sheet screen: what each tab is for, one
   line each, plus who to call when something is wrong. Must fit a 6-inch phone with no
   scrolling.
3. Every empty state in the new group gets a working action, not just an explanation. The
   guest-list empty state already does this well — copy its shape.
4. One first-visit hint per screen: a single line under the header naming the one thing to
   do ("Tap a family to call them"). Dismiss on any tap, never shown again on that device.
   Five words over the point is too many. One hint per screen, maximum.
5. The line that matters most, and it is a training line, not a feature — CLAUDE.md §11b:
   in remote-shell mode there is no local bundle, so reloading during a Wi-Fi drop lands
   on offline.html and loses the screen. Put this on the offline state, in these words:
   "If the app stops responding, don't reload and don't press back. Wait. Whatever is on
   your screen still works, and anything you already saved will send itself when the
   signal comes back."

DO NOT: add a tour library or any dependency; dim the screen with a spotlight overlay;
gate any action behind a tutorial step; show more than one hint on a screen.

Read first:
  src/components/motion/WelcomeOverlay.tsx
  src/components/ui/EmptyState.tsx
  src/components/native/OfflineBanner.tsx
  src/lib/native/  (how device preferences are stored)
  public/offline.html
  CLAUDE.md §11b, §11c

Files you may change: src/components/motion/WelcomeOverlay.tsx, src/app/(app)/**,
src/components/native/OfflineBanner.tsx, DECISIONS.md. Nothing else.

Done when: a device that has never opened the app gets three cards then a working screen;
a device that has sees nothing; the cheat sheet fits one screen; every empty state has a
button; the offline message says "don't reload"; typecheck and tests pass; tested on a
handset with Wi-Fi toggled off mid-session.
```

---

# V12 — Prove it, or it didn't happen

```
[PREAMBLE]

TASK: Write the test that decides whether this series worked. Two halves: can a stranger
do the job, and does it feel instant.

HALF 1 — TAP BUDGETS. Build e2e/obvious.spec.ts under the `phone` project. Each task is
one test, and each asserts a TAP BUDGET — count real clicks. Over budget FAILS even if the
task completes. That is the point.

  Team session, against NEXT_PUBLIC_UI=v2:
    1. Call the next family who needs calling, from a cold start.     <= 2 taps
    2. Log that call's outcome.                                       <= 2 taps
    3. Find the family "Sharma".                                      <= 3 taps
    4. Give a family a room.                                          <= 4 taps
    5. Mark a hamper delivered, with a photo.                         <= 4 taps
    6. Undo task 4.                                                   <= 1 tap
    7. Mark an arrival arrived.                                       <= 3 taps
  Client session:
    8. Find my own room number.                                       <= 3 taps
    9. See who is arriving today.                                     <= 2 taps

HALF 2 — FEEL BUDGETS. Extend e2e/feel.spec.ts (V1) to assert, not just report. Every M1-M5
metric on every new route must be inside the budget in docs/INTERACTION-CONTRACT.md, at the
venue-Wi-Fi throttle profile. A regression here fails the build.

PLUS a structural test over every route in the new group:
  - every interactive element >= 44 x 44 CSS px
  - computed body font-size >= 16px
  - a visible back control, or it is a bottom-bar destination
  - no more than 7 primary tappable actions in the main column
  - no horizontal scroll at 360px width
  - no element containing the strings "pax", "deliverable", "extraction", "travel leg"
  - at most one row of filter controls, and none above the first content row
  - no full-screen loading state on a route whose data is already in the cache

ALSO write docs/HANDSET-TEST.md — the human version, because the automated one cannot
measure confusion. Nine tasks in plain English, a stopwatch column, and one instruction:
hand the phone to somebody who has never seen the app, say nothing, and write down every
question they ask. Every question is a bug in the screen, not in them. Add a second column
for "did they reload during an outage", because that is the one behaviour that makes things
worse and the only defence is the V11 training line.

Add two npm scripts: "test:obvious" and "test:all-feel" (feel + obvious together).

DO NOT: change anything under src/ to make a test pass. If a budget cannot be met, the
test failing IS the deliverable — it names the screen to fix next. Report which budgets
fail and by how much.

Read first:
  playwright.config.ts
  e2e/feel.spec.ts  (from V1)
  e2e/t2_offline.spec.ts
  docs/INTERACTION-CONTRACT.md  (the Budgets table)
  e2e/fixtures/generate.mjs, scripts/seed-543.mjs

Files you may change: e2e/obvious.spec.ts (new), e2e/feel.spec.ts, docs/HANDSET-TEST.md
(new), package.json (two scripts), DECISIONS.md. Nothing under src/.

Done when: `npm run test:all-feel` runs and every failure names a task, a tap count or a
metric and a number; docs/HANDSET-TEST.md exists; nothing under src/ changed.
```

---

## 4. Running order

| # | Session | Depends on | What it buys | Est. |
|---|---|---|---|---|
| V0 | Write down what "instant" means | — | Every later session has a checkable standard | 1h |
| V0b | **Finish the light ground** | V0 | Tokenises elevation, kills the last dark screen and the nine comments that would make a model design dark | 3h |
| V1 | Measure it before touching it | V0 | A baseline, so the rest is provable not arguable | 3h |
| V2 | Client cache | V1 | Going back stops re-fetching Seoul | 4h |
| V3 | **No button waits for the network** | V2 | **The complaint, fixed.** Highest impact in the series | 1 day |
| V4 | Navigation that already happened | V2, V3 | Tabs and rows paint instantly | 4h |
| V5 | One tap, one round trip | V3 | Kills the 3-hop RSVP save — the most frequent action | 4h |
| V6 | New shell + task-first home | V2–V5 | A runner opens the app and sees the next job | 1 day |
| V7 | The four field jobs | V6 | The actual redesign. Split into 4 sessions if it drifts | 2–3 days |
| V8 | One search | V6 | Typing a name finally works | 4h |
| V9 | Plain words, less of them | V7 | Stops reading as developer software | 3h |
| V10 | Mistakes cheap, no dangerous option | V3, V7 | Removes the fear that makes new people freeze | 1 day |
| V11 | Teach on the screen | V7, V8 | First launch to useful in under a minute | 4h |
| V12 | Prove it | all | Turns "easy" and "fast" into numbers that fail a build | 4h |

**V0b before V6.** It is the cheapest session in the series and the only one that gets
harder if deferred: V6 and V7 copy the elevation and the comments they find, so a dark-ground
shadow left in `Card.tsx` propagates into every new screen, and a comment saying "the night
ground" quietly briefs the model to design dark. Fix it once, at the source, while the app
is still only seven shadows wide.

**V1 before V2, and V3 before V6.** Two reasons this order is not negotiable:

- Without V1's baseline you cannot tell a real improvement from a placebo, and this repo
  has already recorded three sessions lost to measuring the wrong metric (DECISIONS.md,
  2026-08-09).
- Building new screens (V6, V7) on the old blocking-write architecture means building them
  twice. The new UI should be born on the fast path.

**When to flip the flag.** Default `NEXT_PUBLIC_UI` to v2 only after V12 runs green. Until
then v1 is the shipping app and v2 is what you test on a handset. Deleting `(staff)` is a
separate decision for after that — and the Vercel rollback path (`npx vercel rollback`)
plus the fact that the APK is a remote shell means flipping the flag needs no reinstall.

---

## 5. If a session goes wrong

- **The model edits a file outside the list.** `git checkout -- <file>` and re-run with
  that file named in a "you may not change" line. Most common failure with this model class.
- **The model writes SQL or a migration.** Revert. Every prompt says to stop and report a
  missing column instead. If something really is missing, that is your decision.
- **The model adds `tailwind.config.js`.** Delete it. Tailwind v4 here is CSS-first and a
  config file silently overrides the token system in globals.css.
- **The model hardcodes a hex or a duration.** Revert that line and point it at the token
  names in `@theme inline`. This is the most common way a "redesign" quietly destroys a
  design system. The one legitimate exception is `src/app/global-error.tsx`, which replaces
  the root layout and can reach no stylesheet — its five inline hexes are correct and must
  be kept in step with `:root` by hand.
- **The model goes dark.** Any dark ground, dark surface, `prefers-color-scheme` rule,
  `.dark` class, black shadow or arbitrary `shadow-[...]` in the diff: revert it. This app
  is light on both grounds and there is no dark mode to add. The likeliest cause is the
  model reading one of the stale "night ground" comments — if V0b has already run, those
  are gone; if it has not, run it before building any screen.
- **The model makes a write optimistic that cannot be undone.** Revert immediately. Three
  things in this app are permanent at the database level: `delivery_proofs` (insert-only,
  `block_mutation` triggers), a `call_attempts` row once `outcome` is set (frozen by
  `guard_call_attempt`), and server timestamps (`force_server_recorded_at`). An optimistic
  UI over any of them will show a state the database refused, and nobody can repair it
  afterwards — not an admin, not the service role.
- **The model weakens a guard to save a round trip.** Revert. That trade is forbidden;
  DECISIONS.md records it being explicitly declined once already.
- **Typecheck cascades and the model starts guessing.** Stop it. Paste the first error
  only, nothing else.
- **V7 drifts.** Split it into four sessions, one job each. Four narrow sessions beat one
  wide one every time on this model class, and V7 is the only prompt here wide enough to
  need it.
- **You are not sure it actually helped.** Run V12's handset test. Nine tasks, one stranger,
  a stopwatch. Every question they ask out loud is a bug in the screen.
