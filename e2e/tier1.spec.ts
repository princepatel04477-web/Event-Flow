import { test, expect } from '@playwright/test'

import { login, loggedInContext, loginTeam, USERS } from './helpers/auth'
import { db, EVENT_ID, countDeliveryProofs, resetTestData, createPendingDeliverable } from './helpers/db'

/**
 * TIER 1 — the event degrades but survives. 4 points each.
 *
 * Honesty notes:
 *  - T1.4's physical dial is MANUAL (a headless browser cannot drive the
 *    native dialer); the test verifies the dial target the app would use and
 *    that the tap is handed to the system, never navigating the WebView.
 *  - Every test that needs a pending deliverable or a room/leg fixture
 *    CREATES it in the test — reset leaves proof-bearing rows behind by
 *    design (insert-only), so no test may assume a clean table.
 */

test.describe.configure({ mode: 'serial' })

let stateA: string
let stateB: string

test.beforeAll(async ({ browser }) => {
  await resetTestData()
  stateA = await login(browser, USERS.a)
  // User B must be STAFF to write (deliveries, check-in) and a DISTINCT
  // caller for the lock test. Both test accounts are admins (email/password
  // on /admin/login — the reliable session path), so they are distinct
  // callers with different auth.uid().
  stateB = await login(browser, USERS.b)
})

async function eventCode(): Promise<string> {
  const { data } = await db.from('events').select('code').eq('id', EVENT_ID).maybeSingle()
  if (!data) throw new Error(`E2E_EVENT_ID ${EVENT_ID} does not resolve to an event.`)
  return data.code
}

/** Create a throwaway family (group + head guest) for tests that need one. */
async function createFamily(name: string, mobile: string | null): Promise<{ groupId: string; guestId: string }> {
  const { data: group, error: gErr } = await db
    .from('guest_groups')
    .insert({ event_id: EVENT_ID, head_name: name, primary_mobile: mobile, expected_pax: 1, rsvp_status: 'not_started' })
    .select('id')
    .single()
  if (gErr || !group) throw new Error(`createFamily group failed: ${gErr?.message}`)

  const { data: guest, error: guestErr } = await db
    .from('guests')
    .insert({ event_id: EVENT_ID, group_id: group.id, full_name: name, is_head: true })
    .select('id')
    .single()
  if (guestErr || !guest) throw new Error(`createFamily guest failed: ${guestErr?.message}`)

  return { groupId: group.id, guestId: guest.id }
}

test('T1.1 multi-user, no corruption — the caller lock is exclusive', async ({ browser }) => {
  const code = await eventCode()
  const { groupId } = await createFamily('T1.1 Lock Test', '9999900001')

  // User A opens the RSVP form — this claims the 15-minute caller lock.
  const { context: ctxA, page: pageA } = await loggedInContext(browser, stateA)
  await pageA.goto(`/${code}/rsvp/${groupId}`)
  await expect(pageA.getByRole('radio', { name: /Coming/ })).toBeVisible({ timeout: 15_000 })

  // User B opens the same family while A holds the lock. claim_group() is
  // re-entrant only for the SAME caller; for B it must refuse and render the
  // locked state — proving two callers cannot both edit one family.
  const { context: ctxB, page: pageB } = await loggedInContext(browser, stateB)
  await pageB.goto(`/${code}/rsvp/${groupId}`)
  await expect(pageB.getByText(/Someone else is already logging this family/i)).toBeVisible({ timeout: 15_000 })

  // A can still edit — its own lock is intact (re-entrant claim).
  await expect(pageA.getByRole('radio', { name: /Coming/ })).toBeVisible()

  await ctxA.close()
  await ctxB.close()
})

test('T1.2 duplicate delivery handled', async ({ browser }) => {
  // Two staff members attempt to deliver the SAME pending deliverable.
  // Exactly one proof is committed; the second attempt is visibly refused
  // ("Already delivered") — never a silent overwrite or duplicate.
  const proofsBefore = await countDeliveryProofs()
  const code = await eventCode()

  // Create a fresh pending deliverable; both users open ITS detail page.
  const { deliverableId } = await createPendingDeliverable()
  const href = `/${code}/deliveries/${deliverableId}`

  // User A completes the delivery first (sequentially — the duplicate case is
  // about the database refusing a second proof on an already-delivered
  // deliverable, not about two simultaneous uploads).
  const { context: ctx1, page: page1 } = await loggedInContext(browser, stateA)
  await page1.goto(href)
  await expect(page1.getByText(/Confirm you are at the right door/i)).toBeVisible({ timeout: 15_000 })
  await page1.locator('input[type="file"][accept="image/*"]').setInputFiles('e2e/fixtures/proof-test.jpg')
  await expect(page1.getByRole('button', { name: /Confirm delivery/i })).toBeVisible({ timeout: 15_000 })
  await page1.getByRole('button', { name: /Confirm delivery/i }).click()
  // A's proof lands: the detail page flips to the sealed state.
  await expect(page1.getByText(/SEALED|PROOF RECORDED/i).first()).toBeVisible({ timeout: 20_000 })
  await ctx1.close()

  // User B opens the same deliverable — it is now delivered, so the UI must
  // refuse with "Already delivered" (never a second proof or overwrite).
  const { context: ctx2, page: page2 } = await loggedInContext(browser, stateB)
  await page2.goto(href)
  await expect(page2.getByText(/Already delivered/i)).toBeVisible({ timeout: 15_000 })
  await ctx2.close()

  // Exactly one new proof row was created (by A).
  const proofsAfter = await countDeliveryProofs()
  const created = proofsAfter - proofsBefore
  expect(created).toBe(1)
})

test('T1.3 check-in / check-out persists', async ({ browser }) => {
  const code = await eventCode()

  // Clean up any leftover T1.3 Hotel from a PRIOR failed run — `hotels` is
  // unique on (event_id, name), so a stale row would break this insert. The
  // test must be self-healing across runs, not just within one.
  await db.from('rooms').delete().eq('event_id', EVENT_ID).eq('room_number', 'T1.3-101')
  const { data: staleHotels } = await db.from('hotels').select('id').eq('event_id', EVENT_ID).eq('name', 'T1.3 Hotel')
  for (const h of staleHotels ?? []) {
    await db.from('hotels').delete().eq('id', h.id)
  }

  // Create a room + hotel + family, and assign the family to the room
  // directly (the allocation UI is T0.6's territory; here we need the
  // assignment to exist so check-in has something to act on).
  const { data: hotel, error: hErr } = await db
    .from('hotels')
    .insert({ event_id: EVENT_ID, name: 'T1.3 Hotel' })
    .select('id')
    .single()
  expect(hErr).toBeNull()

  const { data: room, error: rErr } = await db
    .from('rooms')
    .insert({ event_id: EVENT_ID, hotel_id: hotel!.id, room_number: 'T1.3-101', capacity: 2, max_capacity: 2 })
    .select('id')
    .single()
  expect(rErr).toBeNull()

  const { groupId, guestId } = await createFamily('T1.3 Checkin Family', '9999900002')

  const { error: aErr } = await db.from('room_assignments').insert({
    event_id: EVENT_ID,
    room_id: room!.id,
    group_id: groupId,
    guest_id: guestId,
  })
  expect(aErr).toBeNull()

  // The check-in screen lists the family; check them in.
  const { context, page } = await loggedInContext(browser, stateA)
  await page.goto(`/${code}/checkin`)
  await expect(page.getByText(/Check in \/ out/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('T1.3 Checkin Family')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^Check in$/i }).click()
  // Wait for the RPC: the row shows "Checked in {time}" (not just the page
  // heading "1 family currently checked in").
  await expect(page.getByText(/Checked in \d/i)).toBeVisible({ timeout: 20_000 })

  // Hard refresh — the state persists from the DB.
  await page.reload()
  await expect(page.getByText(/Checked in \d/i)).toBeVisible({ timeout: 15_000 })

  // Check out.
  await page.getByRole('button', { name: /^Check out$/i }).click()
  await page.getByRole('button', { name: /Confirm check-out/i }).click()
  // Wait for the RPC to complete: the row flips to "Checked out {time}" with
  // an "Out" badge. Do NOT read the DB before this — the RPC is in flight
  // until the UI confirms it.
  await expect(page.getByText(/Checked out \d/i)).toBeVisible({ timeout: 20_000 })

  // DB state, server-stamped.
  const { data: assignment } = await db
    .from('room_assignments')
    .select('checked_in_at, checked_out_at')
    .eq('group_id', groupId)
    .eq('event_id', EVENT_ID)
    .maybeSingle()
  expect(assignment).not.toBeNull()
  expect(assignment!.checked_in_at).not.toBeNull()
  expect(assignment!.checked_out_at).not.toBeNull()
  // Both server-stamped — the browser clock never writes these.
  const inMs = new Date(assignment!.checked_in_at!).getTime()
  const outMs = new Date(assignment!.checked_out_at!).getTime()
  expect(Math.abs(Date.now() - outMs)).toBeLessThan(5 * 60 * 1000)
  expect(outMs).toBeGreaterThanOrEqual(inMs)

  // Clean up THIS test's own hotel + room. The reset never touches
  // rooms/hotels (the venue's real rooms must survive), and `hotels` has a
  // `unique (event_id, name)` — leaving this hotel behind would make run 2
  // fail its insert with a unique violation. The room_assignments row was
  // already swept by the reset; deleting the room cascades nothing here.
  await db.from('rooms').delete().eq('id', room!.id)
  await db.from('hotels').delete().eq('id', hotel!.id)

  await context.close()
})

test('T1.4 calling — dial goes to the system, session survives a remount', async ({ browser }) => {
  const code = await eventCode()

  // A fresh family guarantees the call screen starts in the idle phase — a
  // group with a stranded in-flight attempt (outcome IS NULL) skips straight
  // to the outcome UI and hides the Call button. This test must be
  // self-healing across runs, not dependent on which families survived a
  // prior run.
  const { groupId } = await createFamily('T1.4 Call Family', '9999900004')
  const { data: freshGroup } = await db
    .from('guest_groups')
    .select('id, primary_mobile')
    .eq('id', groupId)
    .maybeSingle()

  const group = freshGroup
  test.skip(!group?.primary_mobile, 'No family head with a primary mobile to test the dial target.')

  const { context, page } = await loggedInContext(browser, stateA)

  // The dial target comes from the same phone library the app uses
  // (src/lib/phone.ts). We cannot drive the native dialer from a headless
  // browser, so we verify the library's output for the DB number: digits
  // only, country code, no spaces/dashes.
  const { dialTarget } = await import('../src/lib/phone')
  const target = dialTarget(group!.primary_mobile)
  expect(target).not.toBeNull()
  expect(target!.href).toMatch(/^tel:\+?[0-9]+$/)

  // The call control must hand the dial to the SYSTEM, never navigate the
  // WebView. In a headless browser there is no Capacitor dialer, so the
  // app's navigation layer is instrumented with a seam: when
  // __NUVENT_OPEN_EXTERNAL__ is set, the click handler calls it instead of
  // navigating. We record what it is handed and assert the page did not
  // move. This is what catches the Tier-0 bug: a plain <a href="tel:...">
  // (or window.location.href = tel:) that navigates the WebView would fire
  // the native anchor navigation, the app would reload, and the session
  // would be lost — but the seam never gets the call.
  await page.addInitScript(() => {
    ;(window as unknown as { __NUVENT_OPEN_EXTERNAL__?: (url: string) => void }).__NUVENT_OPEN_EXTERNAL__ = (
      url: string,
    ) => {
      ;(window as unknown as { __NUVENT_DIALED__?: string }).__NUVENT_DIALED__ = url
    }
  })

  await page.goto(`/${code}/call/${group!.id}`)
  await expect(page.locator('body')).toContainText(/Primary mobile/i, { timeout: 15_000 })
  const callButton = page.getByRole('button', { name: /^Call /i })
  await expect(callButton).toBeVisible({ timeout: 15_000 })

  // Clicking Call must hand the tel: URL to the system handoff and leave the
  // page exactly where it was — no WebView navigation to tel:, no redirect
  // to /login.
  await callButton.click()
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __NUVENT_DIALED__?: string }).__NUVENT_DIALED__ ?? null),
      { timeout: 10_000 },
    )
    .not.toBeNull()
  const handed = await page.evaluate(
    () => (window as unknown as { __NUVENT_DIALED__?: string }).__NUVENT_DIALED__ as string,
  )
  expect(handed).toBe(target!.href)
  // Still on the call screen, still signed in.
  expect(page.url()).toContain(`/${code}/call/`)
  await expect(page.locator('body')).toContainText(/Primary mobile/i, { timeout: 15_000 })

  // The call_attempts row was written BEFORE the dial fired (the row must
  // exist server-side before the dialer backgrounds the WebView — the
  // documented resume-first contract in src/lib/call/session.ts). One row,
  // for this group, with the correct dialed number.
  const { data: attemptRows } = await db
    .from('call_attempts')
    .select('dialed_number')
    .eq('group_id', group!.id)
    .eq('event_id', EVENT_ID)
  expect(attemptRows?.length).toBeGreaterThan(0)
  expect(attemptRows?.at(-1)?.dialed_number).toBe(target!.dialedNumber)

  // ---- REMOUNT / SESSION-SURVIVAL half ----------------------------------
  // The dialer backgrounds the WebView; Android may discard it and remount
  // from scratch. The session type that actually breaks on remount is the
  // CODE-AUTH (team) session — a JWT in an httpOnly cookie with no GoTrue
  // refresh token. Admin (GoTrue) sessions have their own refresh machinery;
  // team sessions have only the cookie, so a remount that loses it bounces to
  // /login. Log in as TEAM (real UI flow: code -> staff picker -> server
  // sets the cookie + the client persists the claims to durable storage),
  // then simulate the worst case: the httpOnly cookie is gone and the page
  // reloads cold. The app must rehydrate the session from durable storage
  // (Capacitor Preferences on native, localStorage here) so the user is NOT
  // left on /login and the staff identity survives. The middle of the flow
  // may pass through /login (a guard runs first and bounces) — the login page
  // then forwards back because the claims were restored. What must NOT happen
  // is the user being stranded on the login form.
  //
  // A FRESH family: the first half's admin call claimed a 15-minute lock on
  // group, so the team opening the SAME group would be refused as "locked by
  // another caller". The remount half needs its own unlocked family.
  const { groupId: teamGroupId } = await createFamily('T1.4 Remount Family', '9999900005')

  const teamState = await loginTeam(browser)
  const { context: teamCtx, page: teamPage } = await loggedInContext(browser, teamState)

  await teamPage.goto(`/${code}/call/${teamGroupId}`)
  await expect(teamPage.locator('body')).toContainText(/Primary mobile/i, { timeout: 20_000 })

  await teamCtx.clearCookies()
  // The remount must look like a fresh mount — clear the sessionStorage
  // marker the login flow set, so the SessionBridge actually rehydrates.
  await teamPage.evaluate(() => sessionStorage.removeItem('nuvent_session_restored'))
  await teamPage.goto(`/${code}/call/${teamGroupId}`)
  // Staff identity survived the remount — the call screen renders again (not
  // the login form). Wait on the real condition: the family is visible and
  // we are back on the call URL, not /login.
  await expect(teamPage.locator('body')).toContainText(/Primary mobile/i, { timeout: 20_000 })
  await expect
    .poll(() => teamPage.url(), { timeout: 20_000 })
    .not.toContain('/login')
  expect(teamPage.url()).toContain(`/${code}/call/${teamGroupId}`)

  await teamCtx.close()
  await context.close()
})

test('T1.5 arrivals list — mark arrived persists', async ({ browser }) => {
  const code = await eventCode()

  // Create a family with an arrival leg so it shows on the arrivals board.
  const { groupId } = await createFamily('T1.5 Arrival Family', '9999900003')
  const { error: legErr } = await db.from('travel_legs').insert({
    event_id: EVENT_ID,
    group_id: groupId,
    direction: 'arrival',
    travel_date: '2026-12-19',
    travel_time: '10:30',
    mode: 'train',
  })
  expect(legErr).toBeNull()

  const { context, page } = await loggedInContext(browser, stateA)
  await page.goto(`/${code}/arrivals`)
  // The heading is the unambiguous signal the screen loaded (the body may
  // also contain "No arrivals match these filters" when a filter hides rows).
  await expect(page.getByRole('heading', { name: 'Arrivals' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('T1.5 Arrival Family')).toBeVisible({ timeout: 15_000 })

  // One-tap Mark arrived.
  await page.getByRole('button', { name: /Mark arrived/i }).click()
  await expect(page.getByText(/Arrived/i).first()).toBeVisible({ timeout: 15_000 })

  // Hard refresh — the state persists from the DB.
  await page.reload()
  await expect(page.getByText(/Arrived/i).first()).toBeVisible({ timeout: 15_000 })

  // DB state, server-stamped.
  const { data: leg } = await db
    .from('travel_legs')
    .select('arrived_at')
    .eq('group_id', groupId)
    .eq('event_id', EVENT_ID)
    .eq('direction', 'arrival')
    .maybeSingle()
  expect(leg).not.toBeNull()
  expect(leg!.arrived_at).not.toBeNull()
  expect(Math.abs(Date.now() - new Date(leg!.arrived_at!).getTime())).toBeLessThan(5 * 60 * 1000)

  await context.close()
})

test('T1.6 dashboard accuracy', async ({ browser }) => {
  const code = await eventCode()
  const { context, page } = await loggedInContext(browser, stateA)

  await page.goto(`/${code}`)
  await expect(page.locator('body')).toContainText(/Total pax on the list|Total groups/i, { timeout: 15_000 })

  // Read the dashboard's stated numbers and compare against direct DB counts.
  const { data: stats } = await db.from('v_event_dashboard').select('*').eq('event_id', EVENT_ID).maybeSingle()
  test.skip(!stats, 'v_event_dashboard returned no row for this event.')

  const dashboardText = await page.locator('body').innerText()

  // The dashboard shows "Total groups N" — assert the number matches.
  const uiGroups = extractNumber(dashboardText, /Total groups?[:\s]*([\d,]+)/i)
  const dbGroups = await db.from('guest_groups').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID)
  if (uiGroups !== null) {
    expect(uiGroups).toBe(dbGroups.count ?? 0)
  }

  const uiPax = extractNumber(dashboardText, /Total pax[:\s]*([\d,]+)/i)
  const dbPax = stats!.total_pax as number
  if (uiPax !== null) {
    expect(uiPax).toBe(dbPax)
  }

  const uiHampers = extractNumber(dashboardText, /Hampers delivered[:\s]*([\d,]+)/i)
  if (uiHampers !== null) {
    const dbHampers = stats!.hampers_delivered as number
    expect(uiHampers).toBe(dbHampers)
  }

  await context.close()
})

// T1.7 walks 14 routes with a networkidle wait each; the default 60s
// wall-clock cap is exceeded under machine load even though every page
// renders. Budget it for the work it does (14 navigations), not a single
// fast page — the assertions are the point, not the clock.
test('T1.7 mobile viewport integrity', async ({ browser }) => {
  test.setTimeout(120_000)
  const code = await eventCode()
  const { context, page } = await loggedInContext(browser, stateA)

  const routes = ['', 'queue', 'guests', 'rooms', 'rooms/allocate', 'deliveries', 'fleet', 'logistics', 'departures', 'review', 'arrivals', 'checkin', 'rsvp', 'export']
  const failures: string[] = []

  for (const route of routes) {
    await page.goto(`/${code}${route ? `/${route}` : ''}`)
    // Wait on a real condition: the page shell heading (or any heading) is
    // visible before measuring layout. No fixed sleep.
    await page.locator('h1, h2, h3, h4').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    await page.waitForLoadState('networkidle').catch(() => {})

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth)
    if (overflow > 360) {
      failures.push(`${route || 'dashboard'}: scrollWidth ${overflow} > 360`)
    }

    // No text truncation: for every visible text node inside the bottom nav,
    // its scroll width must not exceed its client width. A label clipped by a
    // too-narrow flex column ("Depar") reports scrollWidth == clientWidth
    // because the clipping happens in the layout box, not the text — so this
    // check is a backstop, not the primary guard. The primary guard is the
    // label-content assertion below.
    const truncated = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Event sections"]')
      if (!nav) return []
      const bad: string[] = []
      const walker = document.createTreeWalker(nav, NodeFilter.SHOW_TEXT)
      const texts: Text[] = []
      while (walker.nextNode()) texts.push(walker.currentNode as Text)
      for (const t of texts) {
        const el = t.parentElement
        if (!el) continue
        const parent = el.parentElement
        if (!parent) continue
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        const parentStyle = getComputedStyle(parent)
        // Skip a label the parent intentionally clips with ellipsis — the
        // contract here is that NAV labels never need that treatment.
        if (parentStyle.textOverflow === 'ellipsis') continue
        if (el.scrollWidth > el.clientWidth + 1) {
          bad.push(`"${t.textContent?.trim()}" scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`)
        }
      }
      return bad
    })
    if (truncated.length > 0) {
      failures.push(`${route || 'dashboard'}: truncated nav labels: ${truncated.slice(0, 5).join('; ')}`)
    }

    // The nav contract: exactly the five standing-up tabs, all with FULL
    // labels, no abbreviated substitutes ("Depart" for "Departures"), plus a
    // More entry. The old nine-tab bar failed this because it shortened the
    // label AND overflowed the screen — this is the check that catches it.
    const navLabels = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Event sections"]')
      if (!nav) return null
      return Array.from(nav.querySelectorAll('a, button'))
        .map((el) => el.textContent?.trim() ?? '')
        .filter(Boolean)
    })
    if (navLabels) {
      const expected = ['Board', 'Queue', 'Rooms', 'Runs', 'Arrivals', 'More']
      // Every expected tab must be present in order and fully spelled.
      for (const [i, label] of expected.entries()) {
        if (navLabels[i] !== label) {
          failures.push(`${route || 'dashboard'}: nav label ${i} is "${navLabels[i] ?? '(missing)'}", expected "${label}"`)
        }
      }
      if (navLabels.length !== expected.length) {
        failures.push(
          `${route || 'dashboard'}: nav has ${navLabels.length} tabs (${navLabels.join(', ')}), expected ${expected.length} (${expected.join(', ')})`,
        )
      }
    }

    // Every button/link must be at least 44x44 CSS px — the app's stated
    // contract (CLAUDE.md §14: tap targets ≥44px). The original 48px here
    // was stricter than the app promises and flagged the fleet/arrivals
    // primary buttons (min-h-11 = 44px) as violations.
    const MIN_TAP = 44
    const smallTargets = await page.evaluate((min) => {
      const bad: string[] = []
      for (const el of Array.from(document.querySelectorAll('button, a'))) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0 && (r.width < min || r.height < min)) {
          bad.push(`${el.tagName}.${(el as HTMLElement).className.slice(0, 40)} ${Math.round(r.width)}x${Math.round(r.height)}`)
        }
      }
      return bad
    }, MIN_TAP)
    if (smallTargets.length > 0) {
      failures.push(`${route || 'dashboard'}: small tap targets: ${smallTargets.slice(0, 5).join('; ')}`)
    }

    // No overlapping labels: adjacent text elements in the nav must not have
    // intersecting bounding boxes.
    const overlaps = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Event sections"]')
      if (!nav) return []
      const spans = Array.from(nav.querySelectorAll('a, button'))
        .map((el) => {
          const label = el.querySelector('span:not([aria-hidden="true"])')
          if (!label) return null
          const r = label.getBoundingClientRect()
          return { text: label.textContent?.trim() ?? '', r }
        })
        .filter((x): x is { text: string; r: DOMRect } => x !== null && x.r.width > 0 && x.r.height > 0)
      const bad: string[] = []
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          const a = spans[i].r
          const b = spans[j].r
          const overlap = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
          if (overlap) {
            bad.push(`"${spans[i].text}" overlaps "${spans[j].text}"`)
          }
        }
      }
      return bad
    })
    if (overlaps.length > 0) {
      failures.push(`${route || 'dashboard'}: overlapping nav labels: ${overlaps.slice(0, 5).join('; ')}`)
    }
  }

  await context.close()
  // Report every failure; do not soften.
  expect(failures, failures.join('\n')).toEqual([])
})

// ---------------------------------------------------------------------------

function extractNumber(text: string, re: RegExp): number | null {
  const m = re.exec(text)
  if (!m) return null
  return Number(m[1].replace(/,/g, ''))
}
