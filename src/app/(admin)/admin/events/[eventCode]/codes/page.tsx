import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { CodesClient, type CodeRow } from './CodesClient'

export const metadata: Metadata = {
  title: 'Access codes',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Access-code management for one event.
 *
 * Only ever shows `code_prefix` + `last_four` for existing codes — the
 * plaintext does not exist anywhere to show. Issuing a new one is the only
 * way to see a code, and it is visible exactly once.
 *
 * `event_access_codes` is `select using (app.is_admin())`, so a non-admin
 * reaching this route reads zero rows rather than an error. The empty state
 * therefore says "no codes issued", which for a team session would be a lie —
 * hence the admin layout guard above this route.
 */
export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function AccessCodesPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('event_access_codes')
    .select('id, role, code_prefix, last_four, created_at, rotated_at, revoked_at')
    .eq('event_id', event.id)
    .order('created_at', { ascending: false })

  const rows: CodeRow[] = (data ?? []).map((r) => ({
    id: r.id,
    role: r.role as 'team' | 'client',
    prefix: r.code_prefix,
    lastFour: r.last_four,
    createdAt: r.created_at,
    state: r.revoked_at ? 'revoked' : r.rotated_at ? 'retired' : 'live',
  }))

  return (
    <CodesClient
      eventId={event.id}
      eventCode={event.code}
      eventName={event.name}
      rows={rows}
      loadError={error?.message ?? null}
    />
  )
}
