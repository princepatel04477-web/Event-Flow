import { NextResponse } from 'next/server'
import { z } from 'zod'

import type { Json } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/server'
import { getEventAccess } from '@/lib/supabase/queries'

const draftSchema = z.object({
  eventId: z.string().uuid(),
  groupId: z.string().uuid().optional(),
  parsed: z.record(z.string(), z.unknown()),
  confidence: z.record(z.string(), z.number()).optional(),
})

/**
 * Save AI call notes as a draft extraction — never writes guest data directly.
 */
export async function POST(req: Request) {
  const claims = await getSessionClaims()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!claims && !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof draftSchema>
  try {
    body = draftSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const access = await getEventAccess(body.eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (claims && claims.eventId !== body.eventId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let groupId = body.groupId
  if (!groupId) {
    const { data: firstGroup } = await supabase
      .from('guest_groups')
      .select('id')
      .eq('event_id', body.eventId)
      .order('head_name', { ascending: true })
      .limit(1)
      .maybeSingle()
    groupId = firstGroup?.id
  }

  if (!groupId) {
    return NextResponse.json({ error: 'No guest families on this event yet' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('rsvp_extractions')
    .insert({
      event_id: body.eventId,
      group_id: groupId,
      parsed: body.parsed as Json,
      confidence: (body.confidence ?? {}) as Json,
      status: 'draft',
      model: 'grok-voice-agent',
      prompt_version: 'campaign-v1',
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ extraction_id: data?.id })
}
