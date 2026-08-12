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
