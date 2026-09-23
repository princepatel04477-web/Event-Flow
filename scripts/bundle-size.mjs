#!/usr/bin/env node
/**
 * PERF-MEASURE — what the client actually has to download.
 *
 * WHY THIS EXISTS. `next build` with Turbopack prints the route table but not the
 * First Load JS column, so "record before/after bundle sizes" needs a reader. This
 * reads `.next` directly and answers three questions:
 *
 *   1. how much JavaScript ships in total (raw and gzipped)
 *   2. how much of it loads on EVERY route (the shell), which is the part a
 *      lazy-loading change can actually move
 *   3. which individual chunks dominate, and which routes reference them — so a
 *      large chunk can be blamed on a screen rather than on "the app"
 *
 * WHAT IT IS NOT. It is not a budget and it does not fail. Bundle size is not in
 * SPEC-PERF's budget table; the gate is the tap. This is the evidence behind one
 * sentence in the report, and having it as a script is what makes that sentence
 * reproducible.
 *
 * RUN IT AFTER A BUILD:
 *
 *   $env:NEXT_PUBLIC_UI='v2'; npm run build
 *   npm run bundle-size
 *   npm run bundle-size -- --out .brain/bundle-after.json
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

import { formatBytes, summarizeChunks, topChunks } from './perf-core.mjs'

const NEXT_DIR = '.next'

function parseArgs(argv) {
  let out = 'e2e/bundle-size.json'
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      out = argv[i + 1] ?? out
      i += 1
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      process.stdout.write('npm run bundle-size [-- --out FILE]\n')
      process.exit(0)
    } else {
      throw new Error(`unknown argument "${argv[i]}"`)
    }
  }
  return { out }
}

/** Every file under `dir` whose name ends with one of `suffixes`. */
function walk(dir, suffixes) {
  const found = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) found.push(path)
    }
  }
  visit(dir)
  return found
}

const args = parseArgs(process.argv.slice(2))

const chunkFiles = walk(join(NEXT_DIR, 'static'), ['.js'])
if (chunkFiles.length === 0) {
  process.stderr.write(
    `bundle-size: no JavaScript under ${NEXT_DIR}/static — run the build first\n` +
      `             ($env:NEXT_PUBLIC_UI='v2'; npm run build)\n`,
  )
  process.exit(2)
}

/** `static/chunks/abc.js`, with sizes. Read once; every route reuses it. */
const chunks = new Map()
for (const file of chunkFiles) {
  const bytes = readFileSync(file)
  chunks.set(relative(NEXT_DIR, file).split(sep).join('/'), {
    path: relative(NEXT_DIR, file).split(sep).join('/'),
    raw: bytes.length,
    gzip: gzipSync(bytes).length,
  })
}

const total = summarizeChunks([...chunks.values()])

/**
 * The route -> chunks map, from the per-route client-reference manifests the
 * build writes beside each page. A route group such as `(app)` is not part of the
 * URL, so it is stripped; `page` and `route` are the endpoints, not path segments.
 */
const manifestFiles = walk(join(NEXT_DIR, 'server', 'app'), ['_client-reference-manifest.js'])
const routes = new Map()

for (const manifest of manifestFiles) {
  const path = relative(join(NEXT_DIR, 'server', 'app'), manifest).split(sep).join('/')
  const route =
    '/' +
    path
      .replace(/_client-reference-manifest\.js$/, '')
      .split('/')
      .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
      .filter((segment) => segment !== 'page' && segment !== 'route' && segment.length > 0)
      .join('/')

  const source = readFileSync(manifest, 'utf8')
  const referenced = new Set(source.match(/static\/chunks\/[A-Za-z0-9._-]+\.js/g) ?? [])
  routes.set(route === '/' ? '/' : route, [...referenced])
}

// The shell — the chunks that load on EVERY route — is `rootMainFiles` plus
// `polyfillFiles` in each route's `build-manifest.json`. It is the complement of
// the per-route client-reference list, not a subset of it (verified: zero
// overlap), so a route's first load is the union of the two.
//
// The intersection is taken over the manifests that HAVE a shell: nine of the 102
// are route handlers and asset endpoints with none, and intersecting those in
// would answer zero.
const buildManifests = walk(join(NEXT_DIR, 'server', 'app'), ['build-manifest.json'])
const shellSets = buildManifests
  .map((manifest) => {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
    return new Set([...(parsed.rootMainFiles ?? []), ...(parsed.polyfillFiles ?? [])])
  })
  .filter((set) => set.size > 0)
const shell = new Set()
if (shellSets.length > 0) {
  for (const path of shellSets[0]) {
    if (shellSets.every((set) => set.has(path))) shell.add(path)
  }
}

const routeSizes = [...routes.entries()]
  .map(([route, list]) => {
    const entries = [...new Set([...shell, ...list])].map((path) => chunks.get(path)).filter(Boolean)
    const size = summarizeChunks(entries)
    return { route, chunks: entries.length, raw: size.raw, gzip: size.gzip }
  })
  .sort((a, b) => b.raw - a.raw)

const shellEntries = [...shell].map((path) => chunks.get(path)).filter(Boolean)
const shellSize = summarizeChunks(shellEntries)

const report = {
  generatedAt: new Date().toISOString(),
  total,
  shell: { ...shellSize, routes: routes.size },
  routes: routeSizes,
  topChunks: topChunks([...chunks.values()], 15),
}

mkdirSync(dirname(resolve(args.out)), { recursive: true })
writeFileSync(resolve(args.out), `${JSON.stringify(report, null, 2)}\n`)

process.stdout.write(
  `bundle: ${total.count} client chunks · ${formatBytes(total.raw)} raw · ${formatBytes(total.gzip)} gzip\n` +
    `bundle: shell (loaded on every route) ${shell.size} chunks · ${formatBytes(shellSize.raw)} raw · ${formatBytes(shellSize.gzip)} gzip\n` +
    `bundle: ${routes.size} routes\n`,
)
process.stdout.write('bundle: largest routes\n')
for (const route of routeSizes.slice(0, 10)) {
  process.stdout.write(
    `bundle:   ${formatBytes(route.raw).padStart(9)} raw ${formatBytes(route.gzip).padStart(9)} gzip  ${route.chunks} chunks  ${route.route}\n`,
  )
}
process.stdout.write('bundle: largest chunks\n')
for (const chunk of report.topChunks) {
  process.stdout.write(
    `bundle:   ${formatBytes(chunk.raw).padStart(9)} raw ${formatBytes(chunk.gzip).padStart(9)} gzip  ${chunk.path}\n`,
  )
}
process.stdout.write(`bundle: wrote ${args.out}\n`)
