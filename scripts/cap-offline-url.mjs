#!/usr/bin/env node
/**
 * `capacitor:copy:after` hook — runs on every `cap copy` / `cap sync`.
 *
 * Writes server.url into the APK's copy of offline.html so its "Try again"
 * button can navigate back to the app. Capacitor serves that page from
 * https://localhost, so location.reload() only ever reloaded the offline page
 * itself (BUG-HUNT-2026-10-25 #3). See the comment above the meta tag in
 * public/offline.html.
 *
 * Reads the URL from the capacitor.config.json that `cap copy` has just
 * written, so it is always the URL actually baked into this build — the same
 * value the WebView will load — never a second source that could disagree.
 * Only the copy under android/…/assets/public is touched; the source file in
 * public/ keeps an empty value and is also what the Worker serves.
 */
import fs from 'node:fs'
import path from 'node:path'

if (process.env.CAPACITOR_PLATFORM_NAME && process.env.CAPACITOR_PLATFORM_NAME !== 'android') process.exit(0)

const root = process.env.CAPACITOR_ROOT_DIR ?? process.cwd()
const assets = path.join(root, 'android', 'app', 'src', 'main', 'assets')
const config = JSON.parse(fs.readFileSync(path.join(assets, 'capacitor.config.json'), 'utf8'))
const serverUrl = (config.server?.url ?? '').trim()
if (!serverUrl) {
  console.log('cap-offline-url: no server.url in this build, offline.html left as-is')
  process.exit(0)
}

const page = path.join(assets, 'public', 'offline.html')
const html = fs.readFileSync(page, 'utf8')
const pattern = /(<meta name="ef-server-url" content=")[^"]*(")/
if (!pattern.test(html)) {
  console.error(`cap-offline-url: ${page} has no <meta name="ef-server-url"> to fill`)
  process.exit(1)
}
const escaped = serverUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
fs.writeFileSync(page, html.replace(pattern, `$1${escaped}$2`))
console.log(`cap-offline-url: offline.html "Try again" -> ${serverUrl}`)
