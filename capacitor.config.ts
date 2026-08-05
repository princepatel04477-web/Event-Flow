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
 * real URL (e.g. https://eventflow.vercel.app) before building the APK.
 * It is intentionally NOT a real URL — the app must never point at a dead
 * host in a committed config.
 */

/** True when the WebView is pointed at a local dev server (adb reverse / LAN). */
const serverUrlIsLocalhost = ['localhost', '127.0.0.1', '192.168.'].some((p) =>
  (process.env.CAP_SERVER_URL ?? 'http://localhost:8000').includes(p),
)
const config: CapacitorConfig = {
  appId: 'com.eventops.app',
  appName: 'Event Ops',
  // Placeholder in remote-shell mode — the WebView loads server.url, so the
  // local web assets are unused. Must be an existing dir for `cap sync`.
  webDir: 'public',

  server: {
    // TEMP DEV: point at local dev server via adb reverse tunnel
    url: 'http://localhost:8000',
    cleartext: true,
    androidScheme: 'https',
  },

  android: {
    allowMixedContent: false,
  },

  plugins: {
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#f5ead8',
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#f5ead8',
      showSpinner: false,
    },
    // M11 OTA: self-hosted updates from our storage bucket. autoUpdate is off
    // because we drive the getLatest -> download -> next flow manually from
    // OtaUpdater so nothing hot-swaps mid-session.
    CapacitorUpdater: {
      autoUpdate: false,
      // In local dev (server.url is localhost) there is no real update
      // endpoint, so point the updater at the dev server itself — a valid,
      // reachable host. A fake "<deployed_app_url>" placeholder here makes
      // getLatest() throw a DNS error on every launch, which the Next.js dev
      // overlay counts as issues on the phone.
      updateUrl:
        process.env.NEXT_PUBLIC_OTA_UPDATE_URL ??
        (serverUrlIsLocalhost ? 'http://localhost:8000/api/updates' : 'https://<DEPLOYED_APP_URL>/api/updates'),
    },
  },
}

export default config
