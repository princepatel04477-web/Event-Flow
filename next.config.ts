import path from 'node:path'

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* config options here */
  // Pin the workspace root explicitly. There are multiple lockfiles in
  // C:\Users\rebel, and Next.js 16's workspace-root inference picked a
  // different project (Trivoxa-F) — serving the wrong app under `next dev`.
  turbopack: {
    root: path.resolve(__dirname),
  },

  /**
   * Legacy flat staff routes -> section routes.
   *
   * Until the section move, every one of these screens existed twice: once at
   * `/EVENT/arrivals` and again at `/EVENT/logistics/arrivals`. The two copies
   * had already drifted apart (the section copy was ahead in every case), so a
   * runner could see a different, older Arrivals depending on which link they
   * followed. The flat copies are deleted; these redirects keep any link that
   * is already saved on a staff phone, pinned in a WhatsApp thread, or sitting
   * in a browser history working.
   *
   * Permanent (308) on purpose: the flat URLs are not coming back, and a
   * permanent redirect lets the handset cache it rather than asking every time
   * on venue Wi-Fi.
   *
   * These run BEFORE filesystem routing, so every `source` here must be a path
   * that no longer has a page behind it. The `:groupId` pattern below is
   * constrained to a UUID for exactly that reason -- a bare `:groupId` would
   * also match `/EVENT/rsvp/queue` and swallow the whole RSVP section.
   */
  async redirects() {
    const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    return [
      // Travel
      { source: '/:eventCode/arrivals', destination: '/:eventCode/logistics/arrivals', permanent: true },
      { source: '/:eventCode/departures', destination: '/:eventCode/logistics/departures', permanent: true },
      { source: '/:eventCode/departures/new', destination: '/:eventCode/logistics/departures/new', permanent: true },
      { source: '/:eventCode/fleet', destination: '/:eventCode/logistics/fleet', permanent: true },

      // Rooms and hampers
      { source: '/:eventCode/checkin', destination: '/:eventCode/hospitality/checkin', permanent: true },
      { source: '/:eventCode/deliveries', destination: '/:eventCode/hospitality/deliveries', permanent: true },
      { source: '/:eventCode/deliveries/:deliverableId', destination: '/:eventCode/hospitality/deliveries/:deliverableId', permanent: true },

      // Calls
      { source: '/:eventCode/queue', destination: '/:eventCode/rsvp/queue', permanent: true },
      { source: '/:eventCode/review', destination: '/:eventCode/rsvp/review', permanent: true },
      { source: '/:eventCode/review/:extractionId', destination: '/:eventCode/rsvp/review/:extractionId', permanent: true },
      { source: '/:eventCode/call/:groupId', destination: '/:eventCode/rsvp/call/:groupId', permanent: true },
      { source: '/:eventCode/calls/unmatched', destination: '/:eventCode/rsvp/unmatched', permanent: true },
      // One RSVP detail screen, at the path both server actions already
      // revalidate. Constrained to a UUID so the named children above survive.
      { source: `/:eventCode/rsvp/:groupId(${uuid})`, destination: '/:eventCode/rsvp/status/:groupId', permanent: true },

      // Guest list
      { source: '/:eventCode/import', destination: '/:eventCode/guests/import', permanent: true },
      { source: '/:eventCode/export', destination: '/:eventCode/guests/export', permanent: true },

      // The board is the event root, not a screen beneath it.
      { source: '/:eventCode/dashboard', destination: '/:eventCode', permanent: true },
    ]
  },

  // Testing happens on a real Android handset over the LAN (CLAUDE.md's
  // `CAP_DEV_HOST` flow and `npm run mobile:dev`), so the phone reaches this
  // server on a private IP rather than localhost. Next 16 blocks cross-origin
  // requests to dev resources by default, which silently kills HMR and the
  // error overlay on the handset — the dev log fills with
  // "Blocked cross-origin request to /_next/webpack-hmr".
  //
  // Dev-only setting; it has no effect on `next build`. The ranges below are
  // the RFC1918 private blocks, so any handset on any venue or home network
  // works without editing this file.
  allowedDevOrigins: [
    '192.168.0.0/16',
    '10.0.0.0/8',
    '172.16.0.0/12',
  ],
}

export default nextConfig
