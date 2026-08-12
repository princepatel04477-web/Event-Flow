import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * Test runner for the Excel import parser.
 *
 * `environment: 'node'` on purpose. Every module under test is pure — no DOM,
 * no React, no Supabase — and the one async entry point (`parseKnownWorkbook`)
 * only needs `File` and `ArrayBuffer`, both of which are Node globals from 20
 * onward. Pulling in jsdom would triple the start-up cost of a suite that has
 * to run before every commit.
 *
 * The `@/` alias mirrors `tsconfig.json` paths so tests import the modules by
 * exactly the specifier the application uses.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // T1 talks to the REAL project over the network: it issues access codes,
    // exchanges them through the live edge functions and asserts against
    // production rows. That does not belong in the pre-commit loop, where a
    // flaky laptop connection would produce a red board that means nothing
    // (the same reasoning as the retry layer in e2e/helpers/db.ts).
    // Run it deliberately: `npm run test:t1`.
    exclude: ['tests/t1_isolation.test.ts', 'tests/t2_reality.test.ts', '**/node_modules/**', '**/dist/**'],
    globals: false,
    // Loads .env.test / .env.local into process.env before any test module is
    // imported. Without it the DB-backed suites gate on a key that is not
    // there and skip silently — which is exactly how two "cross-event
    // isolation" tests sat in the repo for weeks having never run once.
    setupFiles: ['./tests/setup-env.ts'],
    // The adversarial suite creates users and signs in against the real
    // project; the default 5s is not enough for that round trip.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k.startsWith('SUPABASE_') || k.startsWith('E2E_'))
      ),
    },
  },
})
