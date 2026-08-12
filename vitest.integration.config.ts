import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * The suites that talk to the REAL project: T1 (adversarial isolation) and
 * T2 (venue reality).
 *
 * A separate config rather than an `exclude` override, because `exclude` in the
 * default config wins over an explicit file filter — `vitest run tests/t2...`
 * printed "No test files found" and exited 1, which in CI reads as a broken
 * command rather than as a suite that never ran. Two configs make "which
 * suites am I running" a property of the command, not of a filter interaction.
 *
 * These issue access codes, exchange them through live edge functions and
 * assert against production rows, so they are deliberately NOT part of
 * `npm test`. Run them on purpose:
 *
 *     npm run test:t1     adversarial isolation
 *     npm run test:t2     venue reality
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/t1_isolation.test.ts', 'tests/t2_reality.test.ts'],
    globals: false,
    setupFiles: ['./tests/setup-env.ts'],
    // Real network, real round trips, and T2 fires concurrent writes on
    // purpose. The default 5s times out on a normal connection.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // These suites share rows in one event; running the files in parallel
    // would have T2's cleanup racing T1's canary.
    fileParallelism: false,
  },
})
