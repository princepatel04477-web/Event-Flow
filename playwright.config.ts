import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright acceptance harness (Tier 0 / Tier 1 / Tier 2 + stress).
 *
 * Runs against a dev server (default http://localhost:3000) and the REAL
 * Supabase project via the service-role key in e2e/helpers/db.ts — never
 * against a mocked database. Tests share database state, so workers must be
 * 1: a parallel run would have two tests mutating the same rows.
 *
 * The default project emulates a Pixel 5 at 360px — the app's narrowest
 * supported width. The 'desktop' project is comparison-only and is not part
 * of the scored acceptance run.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  // One worker: tests share the real database and depend on each other's
  // data (Tier 0 is a serial chain).
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'e2e/results.json' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 800 },
      },
      // The acceptance run is the phone project only.
      testMatch: /tier0\.spec\.ts|tier1\.spec\.ts|tier2\.spec\.ts|stress\.spec\.ts/,
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
      testMatch: /tier1\.spec\.ts/,
      // Desktop is comparison-only; it is not scored and is skipped by the
      // acceptance npm script (which passes --project=phone).
    },
    {
      // Round-trip timing harness. Deliberately its own project: the `phone`
      // project's testMatch is the scored acceptance set, and adding perf.spec
      // there would fold measurement noise into the 100-point scoreboard.
      // Run against a production build — see the header of e2e/perf.spec.ts.
      name: 'perf',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 800 },
      },
      testMatch: /perf\.spec\.ts/,
    },
    {
      // Per-request identity isolation. Its own project because it drives two
      // sessions concurrently, which the serial tier suites deliberately do
      // not do — and because a leak here is a correctness bug, not a score.
      name: 'identity',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 800 },
      },
      testMatch: /identity\.spec\.ts/,
    },
  ],
})
