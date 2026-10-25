#!/usr/bin/env node
/**
 * Cloudflare Workers build — `npm run cf:build`.
 *
 * Why this exists instead of a bare `opennextjs-cloudflare build`:
 *
 * The adapter's compileEnvFiles() reads `.env`, `.env.local`, `.env.test`,
 * `.env.production*` and `.env.development*` and writes every value into
 * `.open-next/cloudflare/next-env.mjs`, which is bundled INTO THE WORKER.
 * In this repo that would ship:
 *   .env        SARVAM_API_KEY
 *   .env.local  the Seoul Supabase URL, the old APP_JWT_SECRET, VERCEL_OIDC_TOKEN
 *   .env.test   SUPABASE_SERVICE_ROLE_KEY — bypasses every RLS policy
 * (see node_modules/@opennextjs/cloudflare/dist/cli/utils/extract-project-env-vars.js).
 *
 * So this script moves those files out of the project for the duration of the
 * build, ALWAYS puts them back, and then refuses to succeed unless next-env.mjs
 * came out empty. Configuration reaches the Worker only through wrangler.jsonc
 * `vars` (public values) and `wrangler secret put` (APP_JWT_SECRET).
 *
 * The NEXT_PUBLIC_* values are inlined into the client bundle by `next
 * build`, so they must be in the environment of THIS process:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... NEXT_PUBLIC_UI=v2 npm run cf:build
 *
 * NEXT_PUBLIC_UI is required, not defaulted. It was a Production-only Vercel
 * env var, nothing carried it across in the Cloudflare move, and the Worker
 * silently served the retired v1 UI (BUG-HUNT-2026-10-25 #1). Unset means v1
 * with no error anywhere, so the build refuses rather than guess. It is ALSO a
 * wrangler.jsonc var: the compiled middleware reads process.env at runtime.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const REQUIRED = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_UI']
const missing = REQUIRED.filter((k) => !process.env[k]?.trim())
if (missing.length) {
  console.error(`cf-build: set ${missing.join(', ')} in the environment first.`)
  process.exit(1)
}
if (!['v1', 'v2'].includes(process.env.NEXT_PUBLIC_UI.trim())) {
  console.error(`cf-build: NEXT_PUBLIC_UI must be 'v1' or 'v2', got '${process.env.NEXT_PUBLIC_UI}'.`)
  process.exit(1)
}

// Every name extractProjectEnvVars() can read, for all three modes it compiles.
const ENV_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
  '.env.development',
  '.env.development.local',
  '.env.test',
  '.env.test.local',
]

const stash = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-build-env-'))
const moved = []
let status = 1
try {
  for (const name of ENV_FILES) {
    const from = path.join(root, name)
    if (fs.existsSync(from)) {
      fs.renameSync(from, path.join(stash, name))
      moved.push(name)
    }
  }
  console.log(`cf-build: env files set aside for the build: ${moved.join(', ') || 'none'}`)

  const run = spawnSync('npx', ['opennextjs-cloudflare', 'build'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  status = run.status ?? 1
} finally {
  for (const name of moved) fs.renameSync(path.join(stash, name), path.join(root, name))
  fs.rmSync(stash, { recursive: true, force: true })
  console.log(`cf-build: restored ${moved.length} env file(s)`)
}

if (status !== 0) process.exit(status)

const envModule = path.join(root, '.open-next', 'cloudflare', 'next-env.mjs')
const baked = fs.readFileSync(envModule, 'utf8')
const leaked = [...baked.matchAll(/export const (\w+) = (\{.*\});/g)].filter(([, , obj]) => obj !== '{}')
if (leaked.length) {
  console.error(`cf-build: REFUSING — ${envModule} contains values for: ${leaked.map(([, mode]) => mode).join(', ')}`)
  console.error('cf-build: something re-created an env file mid-build. Do not deploy this output.')
  fs.rmSync(path.join(root, '.open-next'), { recursive: true, force: true })
  process.exit(1)
}
console.log('cf-build: next-env.mjs is empty — no .env values baked into the Worker.')
