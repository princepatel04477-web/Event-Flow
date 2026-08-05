#!/usr/bin/env node
/**
 * OTA release script (M11 step 3).
 *
 * Builds the static export, zips `out/`, uploads it to a Supabase Storage
 * bucket, and updates a manifest.json so the in-app version check can find
 * the newest bundle.
 *
 * NOTE: the app is currently in REMOTE SHELL mode (M2-ALT) — `out/` is not
 * produced by `next build` and the WebView loads a remote URL. This script is
 * the target path for when M2 (static export) lands, or for any future
 * bundle-based OTA. It is safe to run once `out/` exists.
 *
 * Usage:
 *   node scripts/ota-release.mjs <versionName> [versionCode]
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never commit these)
 *   OTA_BUCKET (default 'ota-bundles')
 */

import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const root = resolve(__dirname, '..')

const versionName = process.argv[2]
if (!versionName) {
  console.error('Usage: node scripts/ota-release.mjs <versionName> [versionCode]')
  process.exit(1)
}
const versionCode = Number(process.argv[3] ?? 1)

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const bucket = process.env.OTA_BUCKET ?? 'ota-bundles'

if (!url || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(1)
}

const outDir = join(root, 'out')
if (!existsSync(outDir) || !existsSync(join(outDir, 'index.html'))) {
  console.error(
    'out/ does not exist. This app is in remote-shell mode — run this after M2 (static export) lands, or skip OTA for now.',
  )
  process.exit(1)
}

// 1. Build the static export.
console.log('→ Building static export…')
execSync('npm run build', { cwd: root, stdio: 'inherit' })

// 2. Zip out/.
console.log('→ Zipping out/…')
const zipPath = join(root, `ota-${versionName}.zip`)
if (existsSync(zipPath)) execSync(`del "${zipPath}"`)
execSync(`powershell -Command "Compress-Archive -Path '${join(outDir, '*')}' -DestinationPath '${zipPath}' -Force"`)

// 3. Upload to the bucket via the Storage REST API.
const objectPath = `bundles/${versionName}/${versionCode}.zip`
const zip = readFileSync(zipPath)

console.log(`→ Uploading ${objectPath}…`)
const uploadRes = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/zip',
  },
  body: zip,
})
if (!uploadRes.ok) {
  const text = await uploadRes.text()
  console.error('Upload failed:', uploadRes.status, text)
  process.exit(1)
}

// 4. Update manifest.json.
const manifest = {
  versionName,
  versionCode,
  path: objectPath,
  releasedAt: new Date().toISOString(),
}
const manifestRes = await fetch(`${url}/storage/v1/object/${bucket}/manifest.json`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(manifest),
})
if (!manifestRes.ok) {
  console.error('Manifest upload failed:', manifestRes.status, await manifestRes.text())
  process.exit(1)
}

console.log(`✓ Released ${versionName} (${versionCode}).`)
