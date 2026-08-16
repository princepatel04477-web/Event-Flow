import type { MetadataRoute } from 'next'

/**
 * The web app manifest — the "thumbnail" half of the branding.
 *
 * Two audiences, and neither is the APK:
 *
 *  1. Staff who open the deployed URL in Chrome rather than installing the
 *     shell (the fallback route when a handset cannot take the APK). Without a
 *     manifest, "Add to home screen" produces a screenshot-of-the-page icon
 *     labelled with the <title>, so those phones end up with a different icon
 *     and a different name from everyone else's — which is exactly the
 *     confusion that makes "is your app the same as mine?" unanswerable on the
 *     day.
 *  2. Link unfurls and browser tab chrome.
 *
 * `display: 'standalone'` and the paper `background_color` mean the launch is
 * the same single continuous colour as the native splash (see colors.xml).
 *
 * Note `icons` points at /brand/*, NOT at the src/app/icon.png convention:
 * Next fingerprints the latter, so its URL changes on every build and cannot
 * be written into a static manifest entry by hand.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'EventFlow',
    short_name: 'EventFlow',
    description:
      'Wedding event operations — guest groups, RSVP calling, rooms, hampers and logistics.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Both equal `--ef-paper` in globals.css / `themeColor` in layout.tsx.
    background_color: '#f8f9fa',
    theme_color: '#f8f9fa',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops up to 20% off each edge of a maskable icon, so this is a
      // separate file with the mark drawn smaller — reusing the `any` icon
      // here would clip the calendar badge off the corner.
      {
        src: '/brand/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
