import type { Browser, BrowserContext, Page } from '@playwright/test'

import { loadTestEnv } from './env'

const env = loadTestEnv()

/**
 * Auth helpers for the code-based auth model.
 *
 * Three session types exist (see CLAUDE.md §7 + the auth rewrite):
 *   * ADMIN  — email/password on /admin/login (GoTrue session)
 *   * TEAM   — E-code on /login, then the "Who are you?" staff picker
 *   * CLIENT — C-code on /login (read-only, no picker)
 *
 * Each returns a storageState so a fresh context can resume the session.
 * The code logins drive the REAL UI flow so the server sets the session
 * cookie (Set-Cookie) — addCookies() with httpOnly flags was flaky (the
 * cookie silently failed to send on later navigations). Deliberately NOT a
 * global setup: T0.1 tests persistence across a context boundary.
 */

/** Admin: email/password on /admin/login. */
export async function loginAdmin(browser: Browser): Promise<string> {
  return loginAdminAs(browser, { email: env.E2E_USER_A_EMAIL, password: env.E2E_USER_A_PASSWORD })
}

export async function loginAdminAs(
  browser: Browser,
  opts: { email: string; password: string },
): Promise<string> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(opts.email)
  await page.getByLabel('Password').fill(opts.password)
  await page.getByRole('button', { name: /sign in|enter event/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/admin/login'), { timeout: 20_000 })
  const state = await context.storageState()
  await context.close()
  return JSON.stringify(state)
}

/**
 * Team: E-code on /login, then the "Who are you?" staff picker. Uses the
 * REAL UI flow so the session cookies are set by the server (Set-Cookie),
 * which persist reliably in the storageState — addCookies() with httpOnly
 * flags was flaky (the cookie silently failed to send on later requests).
 */
export async function loginTeam(browser: Browser): Promise<string> {
  return loginTeamAs(browser, env.E2E_TEAM_STAFF)
}

/** Team login picking a SPECIFIC staff member (for multi-caller tests). */
export async function loginTeamAs(browser: Browser, staffName: string): Promise<string> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Access code').fill(env.E2E_TEAM_CODE)
  await page.getByRole('button', { name: /enter event|checking/i }).click()
  await page.waitForURL(/\/pick-staff/, { timeout: 30_000 })
  await page.getByRole('button', { name: staffName, exact: false }).first().click()
  await page.waitForURL((url) => !url.pathname.startsWith('/pick-staff'), { timeout: 30_000 })
  const state = await context.storageState()
  await context.close()
  return JSON.stringify(state)
}

/** Client: C-code on /login (read-only, no picker). Real UI flow so the
 * session cookie is set by the server and persists reliably. */
export async function loginClient(browser: Browser): Promise<string> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Access code').fill(env.E2E_CLIENT_CODE)
  await page.getByRole('button', { name: /enter event|checking/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  const state = await context.storageState()
  await context.close()
  return JSON.stringify(state)
}

/**
 * Back-compat: email/password login now means ADMIN.
 */
export async function login(
  browser: Browser,
  opts: { email: string; password: string },
): Promise<string> {
  return loginAdminAs(browser, opts)
}

/** Open a fresh logged-in context from a storageState. */
export async function loggedInContext(
  browser: Browser,
  storageState: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: JSON.parse(storageState) })
  const page = await context.newPage()
  return { context, page }
}

/** Admin credentials for compatibility with existing tests. */
export const USERS = {
  a: { email: env.E2E_USER_A_EMAIL, password: env.E2E_USER_A_PASSWORD },
  b: { email: env.E2E_USER_B_EMAIL, password: env.E2E_USER_B_PASSWORD },
}
