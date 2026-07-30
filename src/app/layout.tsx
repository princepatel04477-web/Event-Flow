import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

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
    <html lang="en" className="h-full">
      <body className="min-h-dvh bg-bg font-sans text-base text-fg antialiased">
        {children}
      </body>
    </html>
  )
}
