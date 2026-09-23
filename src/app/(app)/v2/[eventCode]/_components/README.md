# v3 components — read this before building a screen

Everything below is the shared kit for the v3 "Simple" look
(`.brain/SPEC-V3.md` §2). Screen jobs **reuse these**; they do not invent
new card/row/button markup. If a screen needs a shape that is not here, the
answer is usually one of these components in a different arrangement.

Import from `@/components/ui/<Name>`.

---

## Rules that apply to every screen

1. **One primary button per screen.** `variant="primary"` is maroon and is
   the commit. If two things look like commits, one of them is a
   `secondary`.
2. **Never hardcode a colour.** Use `bg-paper`, `text-ink`, `text-muted`,
   `bg-ledger-green`, `text-highlight`, etc. The Tailwind names come from
   the `@theme` block in `src/app/globals.css`; the raw hexes live in the
   `--ef-*` tokens and nowhere else.
3. **No `any`, no `console.log`.** Gate: `npx eslint <your files>`.
4. **Tap targets ≥ 44px** (`min-h-11`). **Nothing clips at 360px.**
5. **Text contrast ≥ 4.5:1.** `--ef-subtle` is the lightest text token that
   passes on paper; do not go lighter for a "quiet" label.

---

## `Button` — `@/components/ui/Button`

```tsx
<Button variant="primary" onClick={save}>Save · next family</Button>
<Button variant="secondary" onClick={skip}>Not in room</Button>
<Button variant="ghost" size="sm" leadingIcon={<PlusIcon className="h-5 w-5" />}>Add</Button>
```

| variant | look | default height |
|---|---|---|
| `primary` | maroon fill, white text | `lg` — 56px |
| `secondary` | white, 1.5px hairline | `md` — 52px |
| `danger` | red fill | `md` |
| `ghost` | no fill, no border | `md` |

`size?: 'sm' | 'md' | 'lg'` overrides the default. `sm` is 44px and is the
floor. `loading` disables the button and is **for irreversible commits
only** (the delivery-proof seal); reversible writes use
`useOptimisticAction` + `UndoBar` instead.

For a link that should look like a button, use `LinkButton` (same props
minus `onClick`) — never `<Button onClick={router.push}>`.

## `ScreenHeader` — `@/components/ui/ScreenHeader`

```tsx
// Tab-level screen: title + context, no back arrow.
<ScreenHeader title="Calls" context="196 of 238 families done" />

// Detail screen: back arrow, and search still available.
<ScreenHeader
  title={family.headName}
  context={`${family.relation} · ${family.invitedPax} invited`}
  backHref={`/${event.code}/rsvp`}
  backLabel="Calls"
/>
```

`title` is 30px Bricolage. `context` is the small muted line above it —
dates, "196 of 238 done", a hotel name. `search` defaults to `true` and
renders the round 44px Find button; pass `search={false}` on a screen with
nothing to search (a proof capture, a login form). `actions` takes extra
right-hand controls.

The shell already renders one of these (`AppHeader`) with the screen's
title derived from the URL. **A screen does not need its own header** unless
it is outside the shell — do not render two.

## `NowCard` — `@/components/ui/NowCard`

```tsx
<NowCard
  eyebrow="Right now"
  headline="14 families have no room"
  context="38 beds are free across 12 rooms."
  actionLabel="Place families"
  actionHref={`/${event.code}/hospitality/rooms`}
/>
```

The one dark card on a screen, and the only marigold in the app. **One per
screen.** If two jobs compete, the more urgent one is the card and the other
is a `Row` under "Needs attention".

## `Progress` — `@/components/ui/Progress`

```tsx
<Progress label="Families called" done={196} total={238} tone="green" />
<Progress label="Guests with a bed" done={38} total={74} tone="brand" />
<Progress label="Hampers delivered" done={12} total={40} tone="amber" />
```

label left, `done/total` right in tabular figures, 8px bar. `tone` is the
**domain**, chosen at the call site: calls green, rooms maroon, hampers
amber, `neutral` for a number that is not a health signal. `done > total`
clamps at 100 and `total = 0` renders empty — see `src/lib/ui/metrics.ts`.

## `Row` — `@/components/ui/Row`

```tsx
<Row
  heading="Sharma family"
  meta="Confirmed · 6 guests"
  initials={initials(family.headName)}
  status="Coming"
  tone="done"
  onPress={() => setOpen(true)}
/>

// A room row: the number in the avatar slot instead of initials.
<Row heading="Ravi Kumar" meta="2 guests · shared" badge={
  <span className="figure flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold">104</span>
} />
```

64px minimum, whole row is the tap target, name truncates, one muted meta
line, status is a **word** with a 10px dot beside it (`tone`: `neutral`,
`done` (green), `waiting` (amber), `problem` (red)). This replaces
`ListRow` + `StatusPill` walls — do not put a pill in a row.

`initials(name)` comes from `@/lib/ui/metrics` and returns at most two
characters.

## `BottomBar` — `@/components/ui/BottomBar`

```tsx
<BottomBar
  summary="3 families left in this list"
  secondary={{ label: 'Not in room', onPress: markAbsent }}
  primary={{ label: 'Photo · delivered', onPress: capture }}
/>
```

The screen's ONE primary action, one optional secondary, and a one-line
summary. Fixed above the tab bar.

> **The screen must clear it.** Add `pb-nav-bottombar` (tab bar underneath)
> or `pb-bottombar` (no tab bar) to the element that scrolls. Without it the
> last row of the list hides under the bar.

## `Segmented` — `@/components/ui/Segmented`

```tsx
<Segmented
  label="Travel direction"
  value={view}
  onChange={setView}
  options={[
    { value: 'arrivals', label: 'Arrivals', count: 120 },
    { value: 'departures', label: 'Departures', count: 44 },
  ]}
/>
```

A switch between two views of the **same** list — exactly one is on. Two
options maximum. For a multi-select filter use `Chip` instead.

## `Chip` — `@/components/ui/Chip`

```tsx
<Chip selected={filter === 'call_back'} onClick={() => setFilter('call_back')}>
  Call back
</Chip>
```

A filter or a choice, 40px, maroon when selected (`tone` defaults to
`active`; pass a `StatusTone` when the chip *is* the status, e.g. the RSVP
outcome picker).

## `Stepper` — `@/components/ui/Stepper`

```tsx
<Stepper label="Adults" value={adults} onChange={setAdults} min={0} max={20} />
<Stepper label="Kids" value={kids} onChange={setKids} />
```

`− n +` with 44px buttons. There is deliberately no text input: the keyboard
covers half the screen and lets "6" become "66".

## `BottomSheet` — `@/components/ui/BottomSheet`

```tsx
<BottomSheet open={open} onClose={close} label="Place Sharma family">
  …
</BottomSheet>
```

Every detail and every edit is a sheet, not a page. Navigation mid-task
loses the task.

---

## Tokens worth knowing

| token | use |
|---|---|
| `bg-paper` / `bg-surface` / `bg-surface-2` | page ground / cards / wells and bands |
| `text-ink` / `text-muted` / `text-subtle` | primary / secondary / tertiary text |
| `bg-brand` `text-brand` `bg-brand-tint` | maroon: the primary action and the active tab |
| `text-highlight` `bg-highlight` `text-highlight-fg` | marigold — Now card only |
| `bg-now` `text-now-fg` `text-now-muted` | the dark Now-card plane |
| `ledger-green` / `ledger-amber` / `ledger-red` (+ `-tint`) | done / waiting / problem |
| `font-display` | Bricolage — titles and big numbers only |
| `figure` | IBM Plex Mono + tabular — every figure |
| `code-figure` | mono for phone / flight / train numbers |
| `eyebrow` | small sans label above a heading (not uppercase mono any more) |

## Helpers with tests

`src/lib/ui/metrics.ts` — `progressPercent(done, total)`,
`progressCount(done, total)`, `initials(name)`.
Tests: `tests/v3-metrics.test.ts`.

`src/lib/sections/v3.ts` — `v3TabsFor`, `v3ActiveSection`, `v3ActiveChild`,
`v3ScreenTitle`. Tests: `tests/v3-nav.test.ts`.
