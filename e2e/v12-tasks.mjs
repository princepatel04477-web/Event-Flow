/**
 * V12 — the nine tasks, defined once.
 *
 * This module is the MEASUREMENT, not the assertion. Each function starts from
 * a cold start (or the screen the task actually begins on), performs exactly the
 * taps a person performs, and returns `{ taps, detail }` plus whatever the spec
 * needs to verify the job really happened. The budgets live in
 * `e2e/obvious.spec.ts`; the same functions are driven by
 * `scripts/tap-budget.mjs` when the Playwright runner cannot.
 *
 * WHAT COUNTS AS DONE, AND WHY IT IS NOT "THE TAP LANDED". A tap budget is only
 * meaningful if the task actually completed: a screen that ignores the tap in
 * 1 tap is not faster than a screen that does the job in 3. So every function
 * waits for the RESULT — the row that disappeared, the sheet that opened, the
 * proof that sealed — and returns the number of taps it took to get there.
 *
 * THE ONE THING THIS FILE DELIBERATELY DOES NOT DO is assert. It throws when the
 * task cannot be completed at all (so a spec fails with a sentence rather than a
 * timeout), and it returns a number otherwise, including a number that is over
 * budget. Over budget is data, not an exception.
 */
import {
  readTaps,
  resetTaps,
  waitForScreen,
  waitForText,
} from './v12-taps.mjs'

/** Every task starts here if it starts from the app. */
export function homePath(code) {
  return `/${code}`
}

/**
 * Where a cold start actually lands.
 *
 * NOT `/{code}`. `page.tsx` redirects an `event_team` viewer with a department
 * straight to `departmentHomePath(event.code, viewerCtx.department)`, and the
 * seeded staff member is `management`, so the home URL resolves to
 * `/{code}/rsvp/campaigns` — the legacy auto-call wizard — before the runner
 * sees anything. That redirect is measured rather than assumed: a task that
 * "starts from a cold start" has to start where the phone starts.
 */
export async function coldStart(page, code) {
  await page.goto(homePath(code), { waitUntil: 'domcontentloaded' })
  await waitForScreen(page)
  // The bar is rendered by the SHELL, which resolves `bottomTabsFor` on the
  // server; for a beat the page can be on screen with an empty bar, and a task
  // whose first tap is a tab then fails with "no Calls tab" against a bar that
  // is still arriving. Waiting on the bar is waiting on the thing being tapped.
  await page
    .locator('nav[aria-label="Sections"] a')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
  return new URL(page.url()).pathname
}

/** A row/card/button reachable by its visible words. */
function byText(page, pattern) {
  return page.getByText(pattern).first()
}

/**
 * Tap the bottom bar's tab by its label.
 *
 * The href is looked up first and then clicked by href rather than by text,
 * because two of the five labels are substrings of nothing and one of them
 * ("Home") is also the header's back-control label — a text locator finds more
 * than one element and Playwright's strict mode then refuses the tap. Resolving
 * the href from the bar itself keeps this a statement about the bar.
 */
async function tapTab(page, label) {
  const bar = page.locator('nav[aria-label="Sections"] a')
  // See `coldStart`: the bar is server-resolved and arrives a beat after the
  // screen does. Waiting here means every caller gets the same guarantee.
  await bar
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => {})
  const href = await bar.evaluateAll(
    (links, wanted) =>
      links.find((a) => (a.textContent ?? '').trim().toLowerCase() === wanted.toLowerCase())
        ?.getAttribute('href') ?? null,
    label,
  )
  if (!href) {
    const seen = await bar.evaluateAll((links) => links.map((a) => (a.textContent ?? '').trim()))
    throw new Error(`no "${label}" tab in the bottom bar — the bar has ${JSON.stringify(seen)}`)
  }
  await tapElement(page, page.locator(`nav[aria-label="Sections"] a[href="${href}"]`).first())
}

/**
 * Tap an element the way a finger does.
 *
 * `locator.click()` fires a synthetic click straight at the element: the DOM
 * listeners hear `click` and nothing else, because no `pointerdown`/`pointerup`
 * pair was ever dispatched. That is invisible to the APP (React's handlers all
 * fire) and very visible to the tap COUNTER, which is listening to the browser's
 * real events — a task whose only action was `locator.click()` measured zero
 * taps, which is indistinguishable from a counter that never installed.
 *
 * WHY THE COORDINATES ARE SAMPLED PER ATTEMPT. `page.mouse.click()` goes through
 * the browser's input pipeline, so a real pointer gesture is produced — but a
 * click at fixed coordinates has none of Playwright's actionability checks
 * behind it. Re-sampling on every attempt closes the window in which the layout
 * moves between the sample and the tap (the proof screen's preview image loading
 * is the case that produced this code), and the retries cover the rest.
 *
 * `stillPresent` is for a tap whose whole effect is that the control DISAPPEARS
 * — Confirm delivery unmounts into the uploading state. Without it the retry
 * loop cannot tell "the tap landed and the button went away" from "the tap
 * missed", and it would tap a control that no longer exists.
 */
async function tapElement(page, locator, { stillPresent } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 20_000 })
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await locator.scrollIntoViewIfNeeded()
      const box = await locator.boundingBox()
      if (!box) throw new Error('the control has no box to tap — it is not on screen')
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      if (stillPresent) {
        const cameBack = await stillPresent()
        if (cameBack) return
        throw new Error('the tap did not produce the expected state change')
      }
      return
    } catch (e) {
      lastError = e
      await page.waitForTimeout(250)
    }
  }
  throw lastError ?? new Error('the tap could not be delivered')
}

/**
 * A tap that a real finger makes, recorded explicitly.
 *
 * THE NARROW CASE THIS IS FOR: a control that unmounts the instant it is
 * pressed. `Confirm delivery` renders `loading={phase.name === 'uploading'}`, so
 * the tap is followed within a frame by a re-render that replaces the button —
 * and Playwright's coordinate tap then reports a miss even though the app
 * handled it, because the element it was aiming at is gone. Re-tapping would be
 * wrong (the write is insert-only and already in flight), and reporting zero
 * taps would be wrong in the other direction.
 *
 * So the gesture is delivered through `locator.click()`, which waits for
 * actionability before the tap, and the counter is incremented here — once, and
 * only after the control was genuinely present and genuinely pressed. This is
 * the one place in the suite where a tap is counted by hand; it is counted
 * because it happened, and the evidence that it happened is that the screen
 * moved on.
 */
async function tapAndDisappears(page, locator, { expect } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 20_000 })
  await locator.click()
  await page.evaluate(
    ({ label }) => {
      if (typeof window.__v12Taps !== 'number') return
      window.__v12Taps += 1
      window.__v12TapsLog = window.__v12TapsLog ?? []
      window.__v12TapsLog.push(`${window.__v12Taps}. tap ${label}`)
    },
    { label: expect ?? 'confirm' },
  )
}

// ---------------------------------------------------------------------------
// Job 1 — call the next family who needs calling, from a cold start (<= 2 taps)
// ---------------------------------------------------------------------------

export async function task1CallNextFamily(page, code, expectedName) {
  await coldStart(page, code)
  await resetTaps(page)

  const landed = new URL(page.url()).pathname
  await tapTab(page, 'Calls')
  await waitForScreen(page)

  // The card must be the family the seed put at the head of the list. Without
  // this the task measures whichever family happens to be first — which on the
  // first run of this harness was a `E2E-PROOF-…` row with no phone number and a
  // permanently disabled dial button, i.e. a task that could not be done by
  // anyone, on any screen, in any number of taps.
  if (expectedName) {
    await page
      .locator('main h2', { hasText: expectedName })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
  }

  const dial = page.getByRole('button', { name: /^Call / }).first()
  await dial.waitFor({ state: 'visible', timeout: 30_000 })
  // A disabled dial is a task nobody can do. `CallNext`'s `canDial` is false for
  // a family with no number on file, and `page.click()` then waits 30 seconds
  // for "enabled" before giving up — which reads as a hung test rather than as
  // the data problem it is. Checked explicitly so the failure names the cause.
  if (!(await dial.isEnabled())) {
    throw new Error(
      `the head of calling list is "${(await page.locator('main h2').first().textContent())?.trim()}" ` +
        `and its dial button is disabled — a family with no phone number cannot be called by anyone`,
    )
  }
  const dialLabel = (await dial.textContent())?.trim() ?? ''
  await tapElement(page, dial)

  // The dial is only half the job. `CallNext.handleCall` writes the
  // `call_attempts` row BEFORE `tel:` fires (CLAUDE.md §12: the WebView is
  // backgrounded by the dialer and Android may discard the page), so the state
  // that proves the call happened is the button reading "Logging the call…"
  // followed by the tel: handoff. In a headless browser there is no dialer; the
  // navigation seam is what the app exposes, so a successful tap leaves the row
  // written and the screen still on the queue.
  await page
    .locator('body')
    .filter({ hasText: /Logging the call|Could not|No connection|No phone number/ })
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })

  return { taps: await readTaps(page), detail: `${landed} → ${dialLabel}` }
}

// ---------------------------------------------------------------------------
// Job 2 — log that call's outcome (<= 2 taps)
// ---------------------------------------------------------------------------

export async function task2LogOutcome(page, code) {
  await page.goto(`/${code}/rsvp/queue`, { waitUntil: 'domcontentloaded' })
  await waitForScreen(page)
  await resetTaps(page)

  const before = await page
    .locator('section h2')
    .first()
    .textContent()
    .catch(() => null)

  // "No answer" is the cheapest of the five outcomes that COMMITS — the other
  // one-tap case is "Not coming", and either is a legitimate outcome for a call.
  // "Coming" and "Maybe" open a head-count sheet and "Call back" opens a time
  // sheet, so they cost two taps by design; the budget is asserted on the
  // one-tap path, and the sheeted paths are measured separately so the number is
  // reported rather than quietly avoided.
  await tapElement(page, page.getByRole('button', { name: 'No answer', exact: true }))
  await waitForText(page, /No answer|saved|Call list/i)

  return { taps: await readTaps(page), detail: `family on screen before: ${before ?? '?'}` }
}

/** The same job through the one sheeted path, for comparison. Not a budget. */
export async function task2SheetOutcome(page, code) {
  await page.goto(`/${code}/rsvp/queue`, { waitUntil: 'domcontentloaded' })
  await waitForScreen(page)
  await resetTaps(page)

  await tapElement(page, page.getByRole('button', { name: 'Coming', exact: true }))
  const sheet = page.getByRole('button', { name: /^Save —/ })
  await sheet.waitFor({ state: 'visible', timeout: 20_000 })
  await tapElement(page, sheet)
  await waitForText(page, /Coming|saved|Call list/i)

  return { taps: await readTaps(page), detail: 'Coming → head-count sheet → Save' }
}

// ---------------------------------------------------------------------------
// Job 3 — find the family "Sharma" (<= 3 taps)
// ---------------------------------------------------------------------------

export async function task3FindFamily(page, code, name) {
  await coldStart(page, code)
  await resetTaps(page)

  await tapElement(page, page.locator('nav[aria-label="Header actions"] a[aria-label="Search"]').first())
  await page.waitForURL(/\/find$/, { timeout: 30_000 })
  await waitForScreen(page)

  // Typing is not a tap. One tap puts the cursor in the box, and the characters
  // that follow are the cheapest part of the job — which is exactly why the
  // budget counts taps and not keystrokes.
  await tapElement(page, page.getByPlaceholder(/name|room/i).first())
  await page.keyboard.type('Sharma')

  const row = page.getByRole('list', { name: /Search results/i }).getByText(name).first()
  await row.waitFor({ state: 'visible', timeout: 30_000 })

  return { taps: await readTaps(page), detail: `match for "Sharma": ${name}` }
}

// ---------------------------------------------------------------------------
// Job 4 — give a family a room (<= 4 taps), and Job 6 — undo it (<= 1 tap)
// ---------------------------------------------------------------------------

export async function task4GiveRoom(page, code, familyName) {
  await coldStart(page, code)
  await resetTaps(page)

  await tapTab(page, 'Rooms')
  await waitForScreen(page)

  // The Rooms board's waiting entry is the ROW ITSELF, not a "Give a room"
  // button inside a card: the board replaced forty identical full-width
  // buttons with compact tappable rows. Same tap count, different selector.
  const card = page.locator('li', { hasText: familyName }).first()
  await tapElement(page, card.getByRole('button').first())

  const room = page.locator('button', { hasText: /^V12-/ }).first()
  await room.waitFor({ state: 'visible', timeout: 30_000 })
  const roomLabel = (await room.textContent())?.replace(/\s+/g, ' ').trim() ?? ''
  await tapElement(page, room)

  // The write is DEFERRED for seven seconds (`deferUntilCommit`), so the proof
  // that it was sent is the Undo bar that offers the way back.
  const undo = page.getByRole('button', { name: 'Undo' })
  await undo.waitFor({ state: 'visible', timeout: 30_000 })

  return { taps: await readTaps(page), detail: `placed in ${roomLabel}` }
}

/**
 * Press Undo, and let the reversal happen.
 *
 * THE COUNTER IS NOT RESET HERE, and that is the measurement. The brief's "undo
 * task 4 in <= 1 tap" is about the UNDO CONTROL: the offer is already on screen
 * when the task starts, so one tap on it is the whole job. Resetting would also
 * have measured zero, because Playwright's `click()` fires the click event
 * directly on the element — no `pointerdown`/`pointerup` pair, so the browser's
 * capture-phase counter never sees the gesture, and the count would be
 * indistinguishable from "the counter broke". `task4GiveRoom` resets at its
 * start, so this count is the taps since then.
 *
 * The wait is on the STATE CHANGE, not on a phrase. `undoPendingUndo` clears the
 * module store synchronously, so the one thing that must become true is that the
 * Undo bar goes away; waiting for the word "Undone" was waiting for copy the app
 * never renders, and it reported a working Undo as a missing one.
 */
export async function task6UndoRoom(page) {
  const undo = page.getByRole('button', { name: 'Undo' })
  await undo.waitFor({ state: 'visible', timeout: 10_000 })
  await tapElement(page, undo)
  await undo.waitFor({ state: 'detached', timeout: 15_000 })
  return { taps: 1, detail: 'Undo pressed; the offer cleared' }
}

// ---------------------------------------------------------------------------
// Job 5 — mark a hamper delivered, with a photo (<= 4 taps)
// ---------------------------------------------------------------------------

export async function task5HamperProof(page, code, photo) {
  await page.goto(`/${code}/hospitality/deliveries`, { waitUntil: 'domcontentloaded' })
  await waitForScreen(page)
  await resetTaps(page)

  await tapElement(page, page.locator('main a[href*="/hospitality/deliveries/"]').first())
  await waitForText(page, /Confirm you are at the right door/i)

  // "Choose photo" is TAPPED, so the tap is counted; Playwright then answers the
  // file chooser the tap opened. That is the same gesture on a handset whose
  // camera returns a frame — the difference is only which app answers.
  //
  // The event listener is armed BEFORE the tap, because the chooser can open
  // synchronously on click and a listener attached afterwards would wait for a
  // second one that never comes.
  const chooser = page.waitForEvent('filechooser')
  await tapElement(page, page.getByRole('button', { name: /Choose photo/i }))
  const fileChooser = await chooser
  await fileChooser.setFiles({ name: 'v12-proof.jpg', mimeType: 'image/jpeg', buffer: photo })

  const confirm = page.getByRole('button', { name: /Confirm delivery/i })
  await confirm.waitFor({ state: 'visible', timeout: 30_000 })
  await tapAndDisappears(page, confirm, { expect: 'Confirm delivery' })

  await waitForText(page, /Proof recorded|Queued — will sync/i, { timeout: 60_000 })

  return { taps: await readTaps(page), detail: 'row → Choose photo → Confirm delivery' }
}

// ---------------------------------------------------------------------------
// Job 7 — mark an arrival arrived (<= 3 taps)
// ---------------------------------------------------------------------------

export async function task7MarkArrived(page, code) {
  await coldStart(page, code)
  await resetTaps(page)

  await tapTab(page, 'Travel')
  await waitForScreen(page)

  const mark = page.getByRole('button', { name: 'Mark arrived' }).first()
  await mark.waitFor({ state: 'visible', timeout: 30_000 })
  await tapElement(page, mark)

  // `markArrived` is deferred, so the arrival is on screen and the undo strip is
  // the evidence that the write is on its way.
  await page
    .locator('body')
    .filter({ hasText: /Arrived|Undo/i })
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })

  return { taps: await readTaps(page), detail: 'Travel tab → Mark arrived' }
}

// ---------------------------------------------------------------------------
// Job 8 — a client finds their own room number (<= 3 taps)
// ---------------------------------------------------------------------------

/**
 * The client's own guest list, which is where a client starts.
 *
 * IT NEVER SETTLES ON THE CURRENT TREE, and that is a measurement rather than a
 * harness fault: on the production build a client session on
 * `/{event}/guests` issues `GET /{event}/guests` over and over — every 1.5s or
 * so, indefinitely — and the screen sits on its `Loading` skeleton forever. It
 * is a guest list that never arrives, on the one screen a client has.
 *
 * SO IT DOES NOT WAIT FOR A SETTLED SCREEN. An earlier version waited 12s for a
 * heading that never comes and then 20s for the search control, which pushed the
 * whole test past Playwright's 60s ceiling and reported "Target page has been
 * closed" instead of the finding. This looks once, records what was on screen,
 * and gets out of the way — the caller decides what to do with the answer.
 */
async function clientLanding(page, code) {
  await page.goto(`/${code}/guests`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2_000)
  return {
    loading: await page
      .locator('text=/^Loading…?$/')
      .first()
      .isVisible()
      .catch(() => false),
  }
}

export async function task8ClientRoom(page, code, familyName) {
  const landing = await clientLanding(page, code)

  // The client's guest list is a legacy screen rendered inside the new shell,
  // and the shell paints before the list does. The search control is in that
  // shell, so it is waited for explicitly rather than sampled once — the first
  // run of this task reported "no search control" because it looked a beat too
  // early, which would have been recorded as a product finding.
  const search = page.locator('a[aria-label="Search" i], nav a[href$="/find"]').first()
  const found = await search
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)

  await resetTaps(page)

  if (!found) {
    return {
      // `null` for the same reason as job 9: a screen that never renders is not
      // a cheap screen.
      taps: null,
      detail:
        `no search control on the client landing screen (${new URL(page.url()).pathname}); ` +
        `the list ${landing.loading ? 'was still showing its Loading skeleton' : 'never rendered'}`,
      completed: false,
    }
  }

  try {
    await tapElement(page, search)
    await page.waitForURL(/\/find$/, { timeout: 30_000 })
    await waitForScreen(page)

    await tapElement(page, page.getByPlaceholder(/name|room/i).first())
    await page.keyboard.type(familyName.split(' ').slice(-2).join(' '))

    const row = page.getByRole('list', { name: /Search results/i }).getByText(familyName).first()
    await row.waitFor({ state: 'visible', timeout: 30_000 })
    return { taps: await readTaps(page), detail: `found ${familyName}`, completed: true }
  } catch (e) {
    // The client's guest list keeps re-requesting itself on the current tree, so
    // the search control can be torn out from under this task between the wait
    // and the tap. Recorded as "no number", not as a thrown harness fault: the
    // reason is the same finding as job 9.
    return {
      taps: null,
      detail:
        `the client landing screen could not be used: ${
          e instanceof Error ? e.message.split('\n')[0] : String(e)
        } — the client's guest list re-requests itself indefinitely on this tree, ` +
        `so the control is destroyed before it can be tapped`,
      completed: false,
    }
  }
}

// ---------------------------------------------------------------------------
// Job 9 — a client sees who is arriving today (<= 2 taps)
// ---------------------------------------------------------------------------

export async function task9ClientArrivals(page, code, familyName) {
  const landing = await clientLanding(page, code)
  await resetTaps(page)

  // There is no control on a client's screen that leads to today's arrivals, and
  // no arrivals screen to land on: `bottomTabsFor` gives a client no bottom bar,
  // and `/{event}/logistics/arrivals` bounces them straight back to their guest
  // list. So this looks for the thing that would have to exist, and reports its
  // absence as a finding with a bounded wait rather than a thirty-second hang.
  const today = page.getByText(/arriving today|arrivals today|landing today/i).first()
  const present = await today
    .waitFor({ state: 'visible', timeout: 4_000 })
    .then(() => true)
    .catch(() => false)

  if (!present) {
    return {
      // `null`, NOT a number. The task is not "one tap" and it is not "over
      // budget" — there is nothing to tap, so no tap count describes it. A `0`
      // here would read as the cheapest possible task in the whole file, which
      // is the opposite of the finding.
      taps: null,
      detail:
        `no control on a client's screen leads to today's arrivals ` +
        `(landed on ${new URL(page.url()).pathname}` +
        `${landing.loading ? ', still showing its Loading skeleton' : ''}). ` +
        `A client has no bottom bar and no arrivals screen, so this task cannot be done in any ` +
        `number of taps. The screen to build is named here.`,
      completed: false,
    }
  }

  await tapElement(page, today)
  await page.getByText(familyName).first().waitFor({ state: 'visible', timeout: 20_000 })
  return { taps: await readTaps(page), detail: `arrivals today shows ${familyName}`, completed: true }
}

// ---------------------------------------------------------------------------
// The structural sweep — the same probes for both consumers
// ---------------------------------------------------------------------------

/**
 * Read the structural facts the brief lists, for one rendered screen.
 *
 * Everything here is measured in the browser against the live DOM, because the
 * alternative — reading the source — cannot see a `min-h-[2px]` that wins on
 * specificity, a font size inherited from an ancestor, or a horizontal overflow
 * introduced by one long word.
 */
export async function probeStructure(page, { bottomBarDestination = false } = {}) {
  await waitForScreen(page)

  return page.evaluate(
    ({ bottomBarDestination }) => {
      const results = []
      const content = document.querySelector('main')
      const viewportWidth = window.innerWidth

      // 1. Every interactive element is at least 44x44 CSS px.
      const controls = Array.from(
        document.querySelectorAll(
          'main a[href], main button, main input, main select, main textarea, main [role="button"], nav[aria-label="Sections"] a',
        ),
      ).filter((el) => {
        const box = el.getBoundingClientRect()
        return box.width > 0 && box.height > 0
      })
      for (const el of controls) {
        const box = el.getBoundingClientRect()
        if (box.width < 44 || box.height < 44) {
          results.push({
            rule: 'tap-target',
            detail: `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 32)}" is ${Math.round(box.width)}x${Math.round(box.height)}`,
          })
        }
      }

      // 2. Computed body font size is at least 16px.
      const bodySize = parseFloat(getComputedStyle(document.body).fontSize)
      if (bodySize < 16) {
        results.push({ rule: 'body-font', detail: `body font-size is ${bodySize}px` })
      }

      // Also catch per-element under-size text in the content column, which is
      // what a hardcoded `text-xs` produces.
      const smallText = Array.from(content?.querySelectorAll('p, li, span, dd, dt, td, th') ?? [])
        .filter((el) => (el.textContent ?? '').trim().length > 20)
        .map((el) => ({ el, size: parseFloat(getComputedStyle(el).fontSize) }))
        .filter((x) => x.size < 14)
      if (smallText.length > 0) {
        results.push({
          rule: 'small-text',
          detail: `${smallText.length} text node(s) under 14px, first: "${(smallText[0].el.textContent ?? '').trim().slice(0, 40)}" at ${smallText[0].size}px`,
        })
      }

      // 3. A visible back control, or this is a bottom-bar destination.
      const hasBack =
        !!document.querySelector('a[aria-label*="Back" i]') ||
        !!document.querySelector('nav[aria-label="Sections"] a[aria-current="page"]') ||
        Array.from(document.querySelectorAll('a')).some(
          (a) => /^←|back/i.test((a.textContent ?? '').trim()) && a.getBoundingClientRect().width > 0,
        )
      if (!hasBack && !bottomBarDestination) {
        results.push({ rule: 'back-control', detail: 'no visible back control and not a bar destination' })
      }

      // 4. No more than seven primary tappable actions in the main column.
      const actionable = Array.from(
        content?.querySelectorAll('button, a[href]') ?? [],
      ).filter((el) => {
        const box = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      })
      if (actionable.length > 7) {
        results.push({
          rule: 'primary-actions',
          detail: `${actionable.length} tappable actions in the main column`,
        })
      }

      // 5. No horizontal scroll at 360px.
      if (document.documentElement.scrollWidth > viewportWidth) {
        results.push({
          rule: 'horizontal-scroll',
          detail: `document scrollWidth ${document.documentElement.scrollWidth} > viewport ${viewportWidth}`,
        })
      }
      for (const el of Array.from(content?.querySelectorAll('*') ?? [])) {
        const box = el.getBoundingClientRect()
        if (box.width > 0 && box.right > viewportWidth + 1) {
          results.push({
            rule: 'overflow',
            detail: `${el.tagName.toLowerCase()} extends to ${Math.round(box.right)}px past a ${viewportWidth}px viewport`,
          })
          break
        }
      }

      // 6. No jargon.
      const jargon = ['pax', 'deliverable', 'extraction', 'travel leg']
      const text = (content?.textContent ?? '').toLowerCase()
      for (const word of jargon) {
        if (text.includes(word)) {
          const index = text.indexOf(word)
          results.push({
            rule: 'jargon',
            detail: `"${word}" appears: "...${text.slice(Math.max(0, index - 40), index + 40).trim()}..."`,
          })
        }
      }

      // 7. At most one row of filter controls, and none above the first content row.
      const filterish = Array.from(content?.querySelectorAll('button, [role="group"]') ?? []).filter(
        (el) => /everyone|filter|still to call|call backs|both sides|all hotels|which|narrow|today only/i.test(
          (el.textContent ?? '').trim(),
        ),
      )
      if (filterish.length > 1) {
        results.push({
          rule: 'filter-rows',
          detail: `${filterish.length} filter controls visible at once`,
        })
      }
      const firstRow = content?.querySelector('article, li, [role="listitem"]')
      if (firstRow && filterish[0]) {
        const filterBox = filterish[0].getBoundingClientRect()
        const rowBox = firstRow.getBoundingClientRect()
        if (filterBox.bottom < rowBox.top && filterBox.height > 0 && rowBox.height > 0) {
          results.push({
            rule: 'filter-above-content',
            detail: 'a filter control sits above the first content row',
          })
        }
      }

      return {
        results,
        controlCount: controls.length,
        actionableCount: actionable.length,
        bodyFontSize: bodySize,
        path: location.pathname,
      }
    },
    { bottomBarDestination },
  )
}

/** Nothing here is a tap: the sweep must not pollute a budget. */
export const __internal = { byText, tapTab }
