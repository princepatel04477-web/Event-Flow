import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { MotionProvider } from '@/components/motion/MotionProvider'
import { WelcomeOverlay } from '@/components/motion/WelcomeOverlay'
import { NativeBridge } from '@/components/native/NativeBridge'
import { SessionBridge } from '@/components/native/SessionBridge'
import { OfflineBanner } from '@/components/native/OfflineBanner'
import { SentryErrorBoundary } from '@/components/native/SentryErrorBoundary'
import { initSentry } from '@/lib/sentry'
import { wireExternalLinkInterception } from '@/lib/native/navigation'

import './globals.css'

// Install Sentry global handlers on the client before anything renders.
if (typeof window !== 'undefined') {
  initSentry()
  wireExternalLinkInterception()
}

/**
 * M2 static export: next/font/google is unavailable in the bundled build
 * (Turbopack downloads fonts at build time, which fails on the build machine).
 * Switched to system font stacks. The APK is the only runtime target, and
 * every Android handset ships a serviceable serif + sans + monospace stack.
 *
 * System stack: 'Georgia, serif' (display), 'system-ui, -apple-system, sans-serif'
 * (body), 'Menlo, Consolas, monospace' (figures). Devanagari falls back to the
 * device system font — all Android handsets above API 26 ship Noto Sans
 * Devanagari, which is a better match for the Excel sheet names than a
 * download-at-runtime web font over venue Wi-Fi.
 *
 * If font fingerprinting is restored, inline the CSS file into the out/
 * bundle rather than re-adding next/font/google — a downloaded .woff2 is
 * indistinguishable from a self-hosted one, and the build-time download is
 * the part that breaks.
 */

export const metadata: Metadata = {
  title: {
    default: 'Nuvent',
    template: '%s · Nuvent',
  },
  description:
    'Wedding event operations — guest groups, RSVP calling, rooms, hampers and logistics.',
  applicationName: 'Nuvent',
  appleWebApp: {
    capable: true,
    title: 'Nuvent',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The APK draws under the notch and the gesture bar; the `*-safe`
  // utilities in globals.css depend on this.
  viewportFit: 'cover',
  // One colour, both media: the staff app does not follow the OS, so the
  // system chrome must not either. A white status bar over the teal
  // ground is the tell that the two disagree.
  themeColor: '#071a1d',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // suppressHydrationWarning: the Android WebView injects a style
    // attribute with --safe-area-inset-* vars onto <html> (viewport-fit
    // cover) before React hydrates. The server cannot know those values, so
    // we let React keep the WebView's version instead of erroring.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-dvh bg-paper font-sans text-base text-ink antialiased">
        <SentryErrorBoundary>
          <SessionBridge />
          <NativeBridge />
          {/* OtaUpdater temporarily removed — @capgo/capacitor-updater's
              native init calls Capacitor core's notifyListeners(..., true),
              which throws in Capacitor 8 and blanks the WebView. Restore once
              the core/capgo versions align. */}
          <OfflineBanner />
          {/* MotionProvider renders no DOM — it supplies the LazyMotion and
              MotionConfig context (OS reduced-motion, the house easing) and
              code-splits the feature bundle off the initial route. It wraps
              WelcomeOverlay because the overlay uses `m` components, and
              wraps `children` so screens can animate without each one
              re-establishing the context. */}
          <MotionProvider>
            <WelcomeOverlay />
            {children}
          </MotionProvider>
        </SentryErrorBoundary>
      </body>
    </html>
  )
}
