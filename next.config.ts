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
}

export default nextConfig
