import type { Metadata } from 'next'

import { HarvestDebugClient } from './HarvestDebugClient'

export const metadata: Metadata = {
  title: 'Harvest debug',
}

/**
 * /admin/harvest-debug — H1 + H2 device-level diagnostics.
 *
 * Admin-only (checked by the layout). Shows permission state, discovered
 * folders, raw file listings, and the H2 ledger.
 */
export default async function HarvestDebugPage() {
  return <HarvestDebugClient />
}
