/**
 * V12 — the shared measurement half of `e2e/obvious.spec.ts`.
 *
 * WHY A `.mjs` FILE AND NOT A `.ts` ONE, AND WHY IT IS SHARED
 *
 * This repository has an unusual constraint: the Playwright RUNNER was believed
 * to hang here, so a spec on its own could not produce a number. Whether or not
 * that turns out to be true on the day (see DECISIONS.md, V12), the honest
 * design is to keep the TASK DEFINITION in one place and let two consumers use
 * it:
 *
 *   - `e2e/obvious.spec.ts` imports it and asserts the budgets. This is the
 *     deliverable: it is what fails a build when a budget regresses.
 *   - `scripts/tap-budget.mjs` imports the SAME functions and prints the real
 *     numbers without the runner. If the runner hangs, the numbers still exist;
 *     if it does not, the two agree by construction rather than by luck.
 *
 * A second copy of "tap the hamper row, then take the photo" would drift from
 * the first within one session, and then the script would report a green that
 * the spec does not agree with.
 *
 * WHY THE TAP COUNTER IS INSTALLED THE WAY IT IS
 *
 * The budget is TAPS, and the only honest place to count a tap is the browser,
 * in a capture-phase listener, on the events a finger actually produces. A
 * counter written around Playwright's own `click()` calls would miss a real
 * navigation that happened to be tap-free (or count one that was not a tap).
 *
 * Three event types because a tap is not always a click: `click` covers the
 * browser's synthesised click, `pointerup` covers a touch that a handler
 * consumed before the click fired, and `keydown` covers Enter on a focused
 * control — a screen-reader user's tap is not a pointer at all, and a budget
 * that ignores them measures a different product. All three are de-duplicated
 * per gesture so one tap never counts twice.
 *
 * A FOCUSED FIELD'S FIRST TAP COUNTS, AND TYPING DOES NOT. Tapping a search box
 * is a tap; the characters that follow are not. That distinction is the whole
 * reason the tap budget is worth measuring: "find the family Sharma in three
 * taps" should not be satisfied by a screen that needs four taps and a keyboard.
 */

/** The flag `FirstRunCards` reads. See `_components/device-flags.ts`. */
export const ONBOARDED_KEY = 'nuvent.v2.onboarded'

/**
 * The per-screen hint flags, from `AppHint`'s `hintKey(screen)`.
 *
 * A FIRST-RUN CONTEXT SEES THESE TOO, and they are not decoration: `AppHint`
 * mounts a capture-phase `pointerup` listener on the document while it is
 * unset, so a runner's first tap after arriving would be spent clearing a
 * one-line hint instead of doing the job. That is a real tap a real person
 * makes, and leaving it in would charge every budget for it. A returning device
 * has all of these set, which is the state a tap budget is about.
 */
export const HINT_KEYS = [
  'nuvent.v2.hint.rsvp-queue',
  'nuvent.v2.hint.rooms-give',
  'nuvent.v2.hint.hamper-run',
  'nuvent.v2.hint.logistics-arrivals',
]

/**
 * `CallNext`'s per-phone starting point in the calling list.
 *
 * `getOrCreateOffset()` picks a RANDOM 0-11 on first use and stores it here, so
 * that ten callers are not all shown the same uncle. That is right for the field
 * and wrong for a measurement: a task whose subject is "the family on the card"
 * would be measured against a different family on every run, and "call the next
 * family" cannot be asserted at all. Pinning the offset to 0 makes the card the
 * deterministic head of the list — the family the seed put there.
 *
 * It is set rather than worked around because the value is a real per-session
 * fact the app reads, not a test hook: the runner's phone has picked 0 for this
 * session, which is a state a real handset can be in.
 */
export const QUEUE_OFFSET_KEY = 'eventflow:queue:offset'

/**
 * Mark the device as already onboarded before the app's first script runs.
 *
 * THE POINT OF THIS FUNCTION, IN ONE SENTENCE: `FirstRunCards` renders a
 * full-screen `fixed inset-0 z-50` overlay on any device that has not set
 * `nuvent.v2.onboarded`, a fresh Playwright context is such a device, and every
 * control underneath the overlay is unclickable — so a tap budget measured
 * without this flag measures the three onboarding cards, not the task.
 *
 * It is set rather than clicked through on purpose. Clicking "Next" twice and
 * "Start working" once is three taps that belong to a one-time onboarding
 * journey, not to the job; charging them to the job's budget would make every
 * number in this file wrong in the same direction and would hide a regression
 * behind a constant. The flag is also what a real returning handset holds, and
 * a tap budget is a statement about a returning handset.
 *
 * `addInitScript` and not `page.evaluate` after a first navigation: the flag has
 * to be in storage BEFORE `device-flags.ts` runs its one-shot `load()` at module
 * import, or the cards render for a frame and then vanish. The guard means a
 * later navigation never overwrites whatever the app itself has since written.
 */
export async function markOnboarded(context) {
  await context.addInitScript(
    ({ onboardedKey, hintKeys, queueOffsetKey }) => {
      try {
        if (window.localStorage.getItem(onboardedKey) === null) {
          window.localStorage.setItem(onboardedKey, '1')
        }
        for (const key of hintKeys) {
          if (window.localStorage.getItem(key) === null) {
            window.localStorage.setItem(key, '1')
          }
        }
      } catch {
        /* storage blocked — the spec fails loudly on the overlay instead */
      }
      try {
        // `sessionStorage`, not localStorage: the app's own key is per session.
        if (window.sessionStorage.getItem(queueOffsetKey) === null) {
          window.sessionStorage.setItem(queueOffsetKey, '0')
        }
      } catch {
        /* the queue falls back to its own random offset, which the spec reports */
      }
    },
    { onboardedKey: ONBOARDED_KEY, hintKeys: HINT_KEYS, queueOffsetKey: QUEUE_OFFSET_KEY },
  )
}

/**
 * Install the tap counter on every document in this context.
 *
 * Returns nothing: the counter lives on `window.__v12Taps` (and a readable
 * `window.__v12TapsLog`), and `resetTaps` / `readTaps` below are the only things
 * that touch it. Installing it per CONTEXT rather than per page means it
 * survives every client-side navigation the task performs, which is exactly the
 * window a tap budget covers.
 */
export async function installTapCounter(context) {
  await context.addInitScript(() => {
    const w = window
    if (w.__v12TapsInstalled === true) return
    w.__v12TapsInstalled = true
    w.__v12Taps = 0
    w.__v12TapsLog = []

    /**
     * One gesture is SEVERAL of the events below, and the first version of this
     * counter counted all of them — a single tap on a button registered as two,
     * which made every budget in the file wrong by a factor of two.
     *
     * The signature is therefore TIME, not target. `pointerup` fires on the
     * innermost element under the finger and `click` fires on the nearest
     * ancestor that is a control, so those two events do not share a target and
     * a target-based key counted them separately.
     *
     * 250ms, AND THE NUMBER IS LOAD-BEARING IN BOTH DIRECTIONS. Too wide and two
     * real taps collapse into one: the room flow taps `Give a room` and then the
     * room row **349ms apart** — measured, on the production build — and an
     * 800ms window reported that as a single tap, which is a budget passing on a
     * count that did not happen. Too narrow and one tap counts twice. The
     * duplicate events of one gesture arrive within ~2ms of each other, and the
     * fastest two deliberate taps in this suite are a third of a second apart,
     * so 250ms sits an order of magnitude clear of both.
     */
    const DEDUPE_MS = 250
    let lastAt = 0

    const bump = (kind, target) => {
      const now = Date.now()
      if (now - lastAt < DEDUPE_MS) return
      lastAt = now
      w.__v12Taps += 1
      const text =
        target && target.closest
          ? (target.closest('button, a, input, select, textarea, [role="button"]')?.textContent ?? '')
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 40)
          : ''
      w.__v12TapsLog.push(`${w.__v12Taps}. ${kind} ${text}`)
    }

    document.addEventListener('click', (e) => bump('click', e.target), true)
    document.addEventListener('pointerup', (e) => bump('pointerup', e.target), true)
    // KEYBOARD SELECTION COUNTS, TYPING DOES NOT. Enter and Space activate a
    // focused control — for a screen-reader or switch-access user that IS the
    // tap, and a budget that ignores it measures a different product. Every
    // other key is typing, and typing is the cheap part of every task here:
    // charging the search box one tap per letter is what made "find the family
    // Sharma" read as four taps when the screen had cost two.
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' || e.key === ' ') bump('keydown', e.target)
      },
      true,
    )
  })
}

/**
 * Run an evaluate against a page that may be navigating underneath us.
 *
 * A server component can issue a redirect, and a screen can keep re-requesting
 * itself — the client's guest list does exactly that on the current tree — so an
 * evaluate that lands mid-navigation throws "Execution context was destroyed".
 * Retrying is the honest fix: the value is still the value, it just has to be
 * read from the document that is actually there.
 */
async function evaluateWithRetry(page, fn, attempts = 5) {
  let lastError = null
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await page.evaluate(fn)
    } catch (e) {
      lastError = e
      await page.waitForTimeout(400)
    }
  }
  throw lastError
}

export async function resetTaps(page) {
  await evaluateWithRetry(page, () => {
    window.__v12Taps = 0
    window.__v12TapsLog = []
  })
}

/**
 * How many taps have happened since `resetTaps`.
 *
 * Returns `-1` when the counter is not installed, which is a harness fault
 * rather than a budget of zero — a silent 0 would report every task as perfect.
 */
export async function readTaps(page) {
  return evaluateWithRetry(page, () =>
    typeof window.__v12Taps === 'number' ? window.__v12Taps : -1,
  )
}

/** The per-tap log, for diagnosing a count that does not match what happened. */
export async function readTapLog(page) {
  return evaluateWithRetry(page, () => window.__v12TapsLog ?? [])
}

/**
 * Wait until the destination is genuinely readable, then return.
 *
 * "Readable" is defined the way the rest of this suite defines it: an `h1`/`h2`
 * inside the content column, and no live skeleton covering the list. A tap
 * budget that stops at "the URL changed" measures Next's router, not the app.
 */
export async function waitForScreen(page, { timeout = 30_000 } = {}) {
  await page.locator('main h1, main h2, header h1, header h2').first().waitFor({
    state: 'visible',
    timeout,
  })
  await page
    .locator('[aria-busy="true"], .animate-pulse')
    .first()
    .waitFor({ state: 'detached', timeout })
    .catch(() => {
      /* no skeleton at all is a pass, not a failure */
    })
}

/** Wait for a specific piece of text — the condition that says the task is done. */
export async function waitForText(page, pattern, { timeout = 30_000 } = {}) {
  await page
    .locator('body')
    .filter({ hasText: pattern })
    .first()
    .waitFor({ state: 'attached', timeout })
}

/** The event code from the URL the session actually landed on. */
export function eventCodeFromUrl(url) {
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0]
  if (!seg) throw new Error(`no event code in ${url}`)
  return seg
}
