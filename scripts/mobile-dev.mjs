#!/usr/bin/env node
/**
 * One command to run the app ON THE PHONE, as an app.
 *
 * The old `mobile:dev` script was `next dev & npx cap run android --livereload`.
 * On Windows npm runs scripts through cmd.exe, where `&` is a SEQUENTIAL
 * separator rather than POSIX backgrounding — so `next dev` blocked forever and
 * the Capacitor launch step never ran. The dev server came up, nothing was ever
 * pushed to the handset, and the only way to see anything was to type the URL
 * into Chrome. That is a browser tab, not the app: no native bridge, so
 * `window.Capacitor` is absent, the Call plugin is unreachable, and `tel:`
 * handling falls back to browser behaviour.
 *
 * What this does instead:
 *   1. Works out the LAN IP the phone must reach (no more hand-editing configs).
 *   2. Starts `next dev` bound to 0.0.0.0 and waits until it actually answers.
 *   3. Re-syncs + rebuilds + installs the APK ONLY when the baked server URL
 *      changed (an IP change). Otherwise it skips straight to launching, so the
 *      common case is seconds rather than a full Gradle build.
 *   4. Launches com.nuvent.app/.MainActivity via adb.
 *
 * Ctrl-C stops the dev server and exits cleanly.
 *
 * Env overrides:
 *   CAP_DEV_HOST   force the LAN IP (skip auto-detection)
 *   PORT           dev server port (default 3000)
 *   JAVA_HOME      required for the Gradle build; auto-filled from the known
 *                  JDK path when unset (see CLAUDE.md "Toolchain").
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_ID = 'com.nuvent.app'
const MAIN_ACTIVITY = `${APP_ID}/.MainActivity`
const PORT = process.env.PORT ?? '3000'
const IS_WINDOWS = process.platform === 'win32'

/**
 * What we last actually INSTALLED, written only after `adb install` succeeds.
 * This is the real staleness marker: without it, one failed build convinces
 * every later run that there is nothing to do, and the app silently keeps
 * pointing at a dead IP.
 */
const INSTALLED_MARKER = path.join(ROOT, 'android/.last-installed-url')

function log(msg) {
  console.log(`\x1b[36m[mobile:dev]\x1b[0m ${msg}`)
}
function warn(msg) {
  console.warn(`\x1b[33m[mobile:dev]\x1b[0m ${msg}`)
}
function fail(msg) {
  console.error(`\x1b[31m[mobile:dev]\x1b[0m ${msg}`)
  process.exit(1)
}

/**
 * Pick the LAN address the handset can route to.
 *
 * Explicitly skips Hyper-V / WSL virtual switches: this machine also has
 * 192.168.176.1 on a vEthernet adapter, which the phone cannot reach. Real
 * Wi-Fi/Ethernet addresses are preferred by scoring, never by luck.
 */
function detectLanHost() {
  if (process.env.CAP_DEV_HOST) return process.env.CAP_DEV_HOST.trim()

  const candidates = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|loopback|docker|wsl/i.test(name)) continue
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      // Prefer a home/office Wi-Fi subnet over other private ranges.
      const score = addr.address.startsWith('192.168.') ? 2 : addr.address.startsWith('10.') ? 1 : 0
      candidates.push({ address: addr.address, score, name })
    }
  }
  if (candidates.length === 0) {
    fail('Could not find a LAN IPv4 address. Set CAP_DEV_HOST=<your ip> and retry.')
  }
  candidates.sort((a, b) => b.score - a.score)
  if (candidates.length > 1) {
    log(`Multiple LAN addresses found; using ${candidates[0].address} (${candidates[0].name}).`)
    log(`  Others: ${candidates.slice(1).map((c) => `${c.address} (${c.name})`).join(', ')}`)
    log('  Override with CAP_DEV_HOST=<ip> if the phone cannot reach it.')
  }
  return candidates[0].address
}

/**
 * Locate adb.
 *
 * The SDK path is tried FIRST, deliberately. Resolving to the bare name "adb"
 * only works when the call also passes `shell: true` — on Windows, spawning a
 * bare command name without a shell is an immediate ENOENT. Mixing the two (a
 * shell-based `adb version` probe, then a shell-less `adb devices`) silently
 * reported "no device connected" on a machine with a device attached. An
 * absolute path works either way, so prefer it and treat bare "adb" as the
 * fallback that always carries a shell.
 */
function resolveAdb() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ??
    (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android/Sdk') : null)
  if (sdk) {
    const candidate = path.join(sdk, 'platform-tools', IS_WINDOWS ? 'adb.exe' : 'adb')
    if (existsSync(candidate)) return { cmd: candidate, useShell: false }
  }

  const onPath = spawnSync('adb', ['version'], { encoding: 'utf8', shell: IS_WINDOWS })
  if (onPath.status === 0) return { cmd: 'adb', useShell: IS_WINDOWS }

  fail('adb not found. Add platform-tools to PATH or set ANDROID_HOME.')
}

/** Connected device serials, excluding offline/unauthorized entries. */
function listDevices(adb) {
  const out = spawnSync(adb.cmd, ['devices'], { encoding: 'utf8', shell: adb.useShell })
  return (out.stdout ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('\tdevice'))
    .map((line) => line.split('\t')[0])
}

/**
 * Any locally installed JDK, for launching the Gradle wrapper.
 *
 * Checks the usual install roots plus Android Studio's bundled JBR, which is
 * present on any machine that can build this project at all.
 */
function findLocalJdk() {
  const roots = [
    'C:/Program Files/Java',
    'C:/Program Files/Eclipse Adoptium',
    'C:/Program Files/Microsoft',
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      const candidate = path.join(root, entry)
      if (existsSync(path.join(candidate, 'bin', IS_WINDOWS ? 'java.exe' : 'java'))) return candidate
    }
  }
  const jbr = 'C:/Program Files/Android/Android Studio/jbr'
  if (existsSync(path.join(jbr, 'bin', IS_WINDOWS ? 'java.exe' : 'java'))) return jbr
  return null
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: IS_WINDOWS,
    ...opts,
  })
  if (res.status !== 0) fail(`${cmd} ${args.join(' ')} — exited with ${res.status}`)
}

/** Poll the dev server until it answers, so we never sync against a dead URL. */
async function waitForServer(url, timeoutMs = 120_000) {
  const started = Date.now()
  process.stdout.write(`\x1b[36m[mobile:dev]\x1b[0m waiting for ${url} `)
  while (Date.now() - started < timeoutMs) {
    try {
      // Any HTTP response (including a 307 to /login) means Next is up.
      await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
      process.stdout.write(' ready\n')
      return true
    } catch {
      process.stdout.write('.')
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  process.stdout.write('\n')
  return false
}

async function main() {
  const host = detectLanHost()
  const serverUrl = `http://${host}:${PORT}`
  const adb = resolveAdb()

  log(`LAN URL for the handset: ${serverUrl}`)

  const devices = listDevices(adb)
  if (devices.length === 0) {
    warn('No device is connected to adb.')
    warn('  Pair over wireless debugging, then: adb connect <ip>:<port>')
    warn('  Continuing anyway — the dev server will start, but nothing will launch.')
  } else {
    log(`Device(s): ${devices.join(', ')}`)
  }

  // 1. Dev server. -H 0.0.0.0 so the phone can reach it, not just localhost.
  log('starting next dev...')
  const dev = spawn('npx', ['next', 'dev', '-H', '0.0.0.0', '-p', PORT], {
    stdio: 'inherit',
    cwd: ROOT,
    shell: IS_WINDOWS,
  })

  // Ctrl-C kills the dev server, which then exits non-zero. Without this flag
  // the exit handler below would report that as a build failure on every
  // ordinary quit.
  let shuttingDown = false
  const shutdown = () => {
    shuttingDown = true
    if (!dev.killed) dev.kill()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  dev.on('exit', (code) => {
    if (shuttingDown) return
    if (code !== 0 && code !== null) fail(`next dev exited with ${code} — is port ${PORT} already in use?`)
  })

  if (!(await waitForServer(serverUrl))) {
    fail(`Dev server never answered on ${serverUrl}. Is the port blocked by a firewall?`)
  }

  if (devices.length === 0) {
    log('Dev server is up. Connect a device and re-run to launch the app.')
    return
  }

  // 2. Rebuild only when the URL baked into the APK is stale. A Gradle build is
  //    ~1-2 minutes; skipping it when the IP has not moved is the difference
  //    between a usable loop and one nobody runs.
  // Only the marker counts. No marker means we cannot prove what is on the
  // phone, so we rebuild — deliberately NOT falling back to the synced config,
  // which is what made a failed build look like a successful one.
  const baked = existsSync(INSTALLED_MARKER)
    ? readFileSync(INSTALLED_MARKER, 'utf8')
    : null
  const needsRebuild = baked?.trim() !== serverUrl

  if (needsRebuild) {
    log(`baked URL is ${baked === null ? 'missing' : `"${baked}"`} — rebuilding APK for ${serverUrl}`)

    run('npx', ['cap', 'sync', 'android'], { env: { ...process.env, CAP_SERVER_URL: serverUrl } })

    if (!process.env.JAVA_HOME) {
      // JAVA_HOME only launches the Gradle wrapper — the build itself runs on
      // the Temurin 21 pinned by org.gradle.java.home in gradle.properties, so
      // any recent JDK works here. Discovered rather than hardcoded: CLAUDE.md
      // named a jdk-26.0.2 path that does not exist on this machine.
      const jdk = findLocalJdk()
      if (jdk) {
        process.env.JAVA_HOME = jdk
        log(`JAVA_HOME was unset — using ${jdk}`)
      } else {
        warn('JAVA_HOME is unset and no JDK was found; the Gradle build will likely fail.')
      }
    }

    log('building debug APK (this is the slow step)...')
    // Absolute path, not a bare `gradlew.bat`. run() uses shell:true on Windows,
    // and Git Bash exports NoDefaultCurrentDirectoryInExePath=1, which tells the
    // child cmd.exe NOT to search the current directory — so the bare name fails
    // with "not recognized" even though cwd is android/. Quoted for spaces.
    const gradlew = IS_WINDOWS
      ? `"${path.join(ROOT, 'android', 'gradlew.bat')}"`
      : './gradlew'
    run(gradlew, ['assembleDebug'], {
      cwd: path.join(ROOT, 'android'),
    })

    const apk = path.join(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk')
    if (!existsSync(apk)) fail(`Build reported success but ${apk} is missing.`)

    log('installing...')
    run(adb.cmd, ['install', '-r', apk], { shell: adb.useShell })
    writeFileSync(INSTALLED_MARKER, serverUrl)
  } else {
    log(`baked URL already matches ${serverUrl} — skipping rebuild`)
  }

  // 3. Launch the real app. NOT `am start -a VIEW -d <url>`, which hands the URL
  //    to the default browser and is how this went wrong before.
  log(`launching ${MAIN_ACTIVITY}`)
  run(adb.cmd, ['shell', 'am', 'start', '-n', MAIN_ACTIVITY], { shell: adb.useShell })

  log('App launched. Edits reload live — no rebuild needed unless your IP changes.')
  log('Ctrl-C stops the dev server.')
}

main().catch((err) => fail(err?.stack ?? String(err)))
