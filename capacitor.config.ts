import type { CapacitorConfig } from '@capacitor/cli'

/**
 * REMOTE SHELL mode (M2-ALT) — see docs/static-export-audit.md verdict HEAVY.
 *
 * The WebView loads the DEPLOYED app rather than a static bundle. This keeps
 * the existing server-rendered Next.js app (server actions, middleware,
 * cookie sessions) working unchanged — the APK is a native shell over the
 * live site. The trade-off is that offline mode is NOT available in this mode
 * (documented in CLAUDE.md).
 *
 * The deployment URL is not live yet. Replace <DEPLOYED_APP_URL> with the
 * real URL before building the APK.
 * It is intentionally NOT a real URL — the app must never point at a dead
 * host in a committed config.
 */

/**
 * The URL the WebView loads.
 *
 * `.trim()` is not cosmetic. A `set CAP_SERVER_URL=http://...:3000 ` in cmd.exe
 * keeps the trailing space, and `cap sync` baked exactly that into
 * android/app/src/main/assets/capacitor.config.json. Capacitor's Bridge passes
 * the string to `Uri.parse()` unmodified (only the separate `new java.net.URL()`
 * host check trims), so the WebView was loading a malformed URL and only worked
 * by luck.
 *
 * The default port is 3000 to match `next dev`; it used to be 8000, so any
 * `cap sync` without CAP_SERVER_URL set baked in a dead URL.
 */
const serverUrl = (process.env.CAP_SERVER_URL ?? 'http://localhost:3000').trim()

const config: CapacitorConfig = {
  appId: 'com.nuvent.app',
  appName: 'Nuvent',
  // Placeholder in remote-shell mode — the WebView loads server.url, so the
  // local web assets are unused. Must be an existing dir for `cap sync`.
  webDir: 'public',

  server: {
    // Set by `npm run mobile:dev`, which auto-detects the LAN IP. Override with
    // CAP_SERVER_URL (e.g. http://<LAN_IP>:3000) for a manual `cap sync`.
    url: serverUrl,
    cleartext: true,
    androidScheme: 'https',
    // Served from the local assets (webDir) when the WebView cannot reach
    // server.url. Without it an unreachable server shows Chromium's own
    // grey error page — the most browser-looking screen in the product, at
    // the worst possible moment. Remote-shell mode has no local bundle, so
    // this file is the only offline surface that exists.
    errorPath: 'offline.html',
    // The LAN dev/prod host must be here: with androidScheme 'https' and an
    // http:// server.url, the WebView externalizes the initial load to the
    // system browser unless the host is allow-listed. Without this the app
    // opens the login page in Chrome/Brave instead of in the WebView.
    //
    // 'tel:*' and 'mailto:*' used to be in this list, with a comment claiming
    // they told the WebView those were "not in-app pages". allowNavigation
    // means the OPPOSITE — it is the allowlist of destinations the WebView is
    // permitted to navigate to ITSELF instead of handing off to the OS. Those
    // entries never matched (allowNavigation is compared against a URL's host,
    // and a tel: URI has no host), so they were inert rather than harmful, but
    // they documented the mechanism backwards. System schemes are handed off
    // explicitly by lib/native/navigation.ts via AppLauncher, and the dialer
    // intents are declared in AndroidManifest.xml's <queries> block.
    allowNavigation: ['192.168.*', '10.*', '172.16.*', '172.17.*', '172.18.*', '172.19.*', '172.20.*', '172.21.*', '172.22.*', '172.23.*', '172.24.*', '172.25.*', '172.26.*', '172.27.*', '172.28.*', '172.29.*', '172.30.*', '172.31.*', 'localhost'],
  },

  android: {
    allowMixedContent: false,
  },

  plugins: {
    // The app ground is dark teal (#071a1d — see `themeColor` in app/layout.tsx).
    // These were cream (#f5ead8) with style 'LIGHT', which is doubly wrong:
    // Capacitor's 'LIGHT' means DARK text (for a light background), so the
    // status-bar icons were dark-on-dark, and the cream splash flashed a pale
    // screen before a dark app. That flash-then-swap is the single most
    // "this is a web page loading" moment in the product.
    //
    // Note `backgroundColor` is a no-op on targetSdk 35+, where Android forces
    // edge-to-edge — the app itself paints under the bar via viewportFit:'cover'
    // plus the safe-area utilities. It is set anyway for older handsets.
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#071a1d',
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#071a1d',
      showSpinner: false,
    },
    // M11 OTA (@capgo/capacitor-updater) intentionally has NO config block.
    //
    // The package is not installed — it was removed because its native init
    // calls Capacitor core's notifyListeners(..., true), which throws on
    // Capacitor 8 and blanks the WebView (see the note in app/layout.tsx).
    // A config block for an absent plugin is inert but was still being baked
    // into the APK, where it reads as "OTA is wired up" to anyone inspecting
    // the build. Restore this together with the dependency and OtaUpdater
    // once the core/capgo versions align.
  },
}

export default config
