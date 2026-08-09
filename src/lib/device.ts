'use client'

import { capacitorStorageAdapter } from '@/lib/supabase/capacitor-storage'

const DEVICE_ID_KEY = 'nuvent_device_id'

/**
 * A stable per-install device id, used for login rate limiting. Generated
 * once and persisted in Capacitor Preferences (native) / localStorage
 * (web) — it survives cache clears on native. NOT a credential: it is
 * only a rate-limit key.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await capacitorStorageAdapter.getItem(DEVICE_ID_KEY)
  if (existing) return existing

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`

  await capacitorStorageAdapter.setItem(DEVICE_ID_KEY, id)
  return id
}
