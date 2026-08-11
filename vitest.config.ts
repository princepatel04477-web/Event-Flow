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
    globals: false,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k.startsWith('SUPABASE_') || k.startsWith('E2E_'))
      ),
    },
  },
})
