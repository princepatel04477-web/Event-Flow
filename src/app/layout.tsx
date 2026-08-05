import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { NativeBridge } from '@/components/native/NativeBridge'
import { OfflineBanner } from '@/components/native/OfflineBanner'
import { OtaUpdater } from '@/components/native/OtaUpdater'
import { SentryErrorBoundary } from '@/components/native/SentryErrorBoundary'
import { initSentry } from '@/lib/sentry'

import './globals.css'

// Install Sentry global handlers on the client before anything renders.
if (typeof window !== 'undefined') {
  initSentry()
}

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
}

// No webfont on purpose. The system stack renders instantly on a cheap
// Android phone and needs nothing from the network at the venue.
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // suppressHydrationWarning: the Android WebView injects a style
    // attribute with --safe-area-inset-* vars onto <html> (viewport-fit
    // cover) before React hydrates. The server cannot know those values, so
    // we let React keep the WebView's version instead of erroring.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-dvh bg-bg font-sans text-base text-fg antialiased">
        <SentryErrorBoundary>
          <NativeBridge />
          <OtaUpdater />
          <OfflineBanner />
          {children}
        </SentryErrorBoundary>
      </body>
    </html>
  )
}
