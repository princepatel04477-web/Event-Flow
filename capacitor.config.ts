import type { CapacitorConfig } from '@capacitor/cli'

/**
 * BUNDLED BUILD (M2 static export — supersedes REMOTE SHELL M2-ALT).
 *
 * The APK contains the full static build in out/. The WebView loads
 * from local assets rather than a remote URL, which means:
 *  - No server required — the app works with no network at all.
 *  - Offline is real, not a promise: the IndexedDB outbox drains when
 *    connectivity returns, and every screen renders from the bundled
 *    HTML/JS/CSS with no round-trip to Vercel.
 *  - Updates are APK updates, not OTA — there is no server.url to point
 *    at a newer deployment.
 */

const config: CapacitorConfig = {
  appId: 'com.nuvent.app',
  appName: 'Nuvent',
  // Static export lives in out/, not public/.
  webDir: 'out',

  server: {
    // Deliberately no `url`: this is the bundled build, so the WebView loads
    // local assets. Adding a url here silently turns the APK back into a
    // remote shell and the bundle in out/ goes unused.
    //
    // `androidScheme` must stay 'https'. The WebView serves local assets from
    // an origin built out of this scheme; on 'http' Android treats it as an
    // insecure origin and withholds the secure-context APIs the app relies on
    // — crypto.subtle (code-auth JWT verify) and IndexedDB persistence (the
    // offline outbox) among them.
    androidScheme: 'https',
  },

  android: {
    allowMixedContent: false,
  },

  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#071a1d',
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 3000,
      launchFadeOutDuration: 200,
      backgroundColor: '#071a1d',
      showSpinner: false,
    },
  },
}

export default config
