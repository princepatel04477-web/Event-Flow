import type { Metadata, Viewport } from 'next'
import {
  Be_Vietnam_Pro,
  IBM_Plex_Mono,
  IBM_Plex_Sans_Devanagari,
} from 'next/font/google'
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
  // tel:/mailto: links belong to the OS, not the WebView — a captured click
  // on one must go to the system dialer and never navigate the WebView (the
  // Tier-0 call bug). This wires the document-level interceptor once.
  wireExternalLinkInterception()
}

/**
 * The four faces of the design, self-hosted.
 *
 * `next/font/google` downloads and fingerprints these at BUILD time and
 * serves them from our own origin, so the venue's Wi-Fi is never in the
 * critical path — a `<link>` to fonts.googleapis.com would leave staff
 * staring at fallback metrics (or nothing) exactly when the network is
 * worst. It also inlines the font-face metrics, so there is no layout
 * shift when they land.
 *
 * `display: 'swap'` on all four: fallback text immediately, never a flash
 * of invisible text.
 */
const beVietnam = Be_Vietnam_Pro({
  subsets: ['latin'],
  // 400 body, 500/600 labels and headlines, 700 display — the four weights
  // the design language names. Nothing else is loaded: each extra weight is
  // another file over venue Wi-Fi.
  weight: ['400', '500', '600', '700'],
  variable: '--font-be-vietnam',
  display: 'swap',
})

/**
 * The Devanagari cut. Family names come off the Excel sheet in Hindi
 * ("शर्मा परिवार") and sit inline with Latin on the same row — without
 * this they fall back to whatever the Android WebView happens to ship,
 * which is a different weight and a different x-height on every handset.
 */
const plexDevanagari = IBM_Plex_Sans_Devanagari({
  subsets: ['devanagari', 'latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-devanagari',
  display: 'swap',
})

/** Every figure in the app. Loaded for its tabular numerals. */
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

/**
 * Cormorant Garamond is gone. The design language puts Be Vietnam Pro
 * "across all tiers", so `font-display` now resolves to it, and shipping a
 * serif nothing references is a font file downloaded for no reason.
 */
const fontVariables = [
  beVietnam.variable,
  plexDevanagari.variable,
  plexMono.variable,
].join(' ')

export const metadata: Metadata = {
  title: {
    default: 'EventFlow',
    template: '%s · EventFlow',
  },
  description:
    'Wedding event operations — guest groups, RSVP calling, rooms, hampers and logistics.',
  applicationName: 'EventFlow',
  appleWebApp: {
    capable: true,
    title: 'EventFlow',
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
  themeColor: '#f8f9fa',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // suppressHydrationWarning: the Android WebView injects a style
    // attribute with --safe-area-inset-* vars onto <html> (viewport-fit
    // cover) before React hydrates. The server cannot know those values, so
    // we let React keep the WebView's version instead of erroring.
    <html lang="en" className={`h-full ${fontVariables}`} suppressHydrationWarning>
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
