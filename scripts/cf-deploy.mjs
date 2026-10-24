#!/usr/bin/env node
/**
 * Cloudflare Workers deploy — `npm run cf:deploy`, after `npm run cf:build`.
 *
 * Stamps GIT_COMMIT_SHA into the Worker so /api/version can answer "which
 * build is this phone talking to?" (CLAUDE.md §12, the frozen-URL trap). On
 * Vercel that came from VERCEL_GIT_COMMIT_SHA for free; Cloudflare has no
 * equivalent. A tree with uncommitted changes is stamped `<sha>-dirty`, so it
 * can never read as a match for a clean commit.
 */
import { execFileSync, spawnSync } from 'node:child_process'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const sha = git('rev-parse', 'HEAD')
const dirty = git('status', '--porcelain').length > 0
const stamp = dirty ? `${sha}-dirty` : sha

console.log(`cf-deploy: GIT_COMMIT_SHA=${stamp}`)
const run = spawnSync('npx', ['wrangler', 'deploy', '--var', `GIT_COMMIT_SHA:${stamp}`], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(run.status ?? 1)
