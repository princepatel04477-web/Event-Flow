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
