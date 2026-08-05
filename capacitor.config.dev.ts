import type { CapacitorConfig } from '@capacitor/cli'

import baseConfig from './capacitor.config'

/**
 * DEV-ONLY Capacitor config for the on-device live-reload loop (M5 Part A).
 *
 * Points the WebView at `next dev` on the LAN so a change on the machine
 * shows up on the handset in ~2s without rebuilding the APK. Used only by
 * `npm run mobile:dev`.
 *
 * Cleartext is enabled here so the device can talk to plain http:// LAN
 * hosts. This MUST live in the debug variant only — never in release.
 */
const devConfig: CapacitorConfig = {
  ...baseConfig,
  server: {
    // Read from env:  CAP_DEV_HOST=192.168.1.42 npm run mobile:dev
    url: `http://${process.env.CAP_DEV_HOST ?? '192.168.1.100'}:3000`,
    cleartext: true,
    androidScheme: 'https',
  },
}

export default devConfig
