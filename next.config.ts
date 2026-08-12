import path from 'node:path'

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // M2: static export — build the app into out/, no server required.
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,

  turbopack: {
    root: path.resolve(__dirname),
  },

  allowedDevOrigins: [
    '192.168.0.0/16',
    '10.0.0.0/8',
    '172.16.0.0/12',
  ],
}

export default nextConfig
