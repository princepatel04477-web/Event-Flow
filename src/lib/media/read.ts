import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { resolveBucket } from './names'

/**
 * A URL a browser can load for a stored object, whichever store it is in.
 *
 * Both branches are permanent. Recordings and proofs written before the R2
 * cutover carry a bare Supabase bucket name, and because those tables have
 * `no_update` triggers their rows can never be repointed — not by an admin,
 * not by the service role. Anything that plays a recording or shows a proof
 * must ask this function rather than assume a store.
 *
 * The two branches differ in a way worth knowing: the Supabase branch mints a
 * signed URL that stays valid for its full hour even if the staff member's
 * access code is revoked thirty seconds later, while the R2 branch returns a
 * route that re-checks the session on every request. The newer path is the
 * stricter one.
 */
export async function mediaReadUrl(
  storageBucket: string | null | undefined,
  storagePath: string,
  { expiresInSeconds = 3600 }: { expiresInSeconds?: number } = {},
): Promise<string | null> {
  // Rows predating the column default still mean the original recordings
  // bucket, which is a Supabase one.
  const resolved = resolveBucket(storageBucket ?? 'call-recordings')

  if (resolved.kind === 'r2') {
    return `/api/media?bucket=${encodeURIComponent(resolved.bucket)}&key=${encodeURIComponent(storagePath)}`
  }

  const supabase = await createClient()
  const { data } = await supabase.storage
    .from(resolved.bucket)
    .createSignedUrl(storagePath, expiresInSeconds)
  return data?.signedUrl ?? null
}
