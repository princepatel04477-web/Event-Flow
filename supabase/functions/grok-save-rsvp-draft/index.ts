import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Tool endpoint for the Grok voice agent during outbound calls.
 * Writes draft rsvp_extractions only — never guest_groups.
 */
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const webhookSecret = Deno.env.get('GROK_WEBHOOK_SECRET') ?? ''

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
      },
    })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  if (webhookSecret && req.headers.get('x-webhook-secret') !== webhookSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    event_id?: string
    group_id?: string
    job_id?: string
    parsed?: Record<string, unknown>
    confidence?: Record<string, number>
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (!body.event_id || !body.parsed) {
    return Response.json({ error: 'event_id and parsed required' }, { status: 400 })
  }

  const { data: extraction, error: insErr } = await db
    .from('rsvp_extractions')
    .insert({
      event_id: body.event_id,
      group_id: body.group_id ?? null,
      parsed: body.parsed,
      confidence: body.confidence ?? {},
      status: 'draft',
      model: 'grok-voice-outbound',
      prompt_version: 'campaign-v1',
    })
    .select('id')
    .single()

  if (insErr) {
    return Response.json({ error: insErr.message }, { status: 500 })
  }

  if (body.job_id) {
    await db
      .from('rsvp_campaign_jobs')
      .update({
        extraction_id: extraction.id,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', body.job_id)
  }

  return Response.json({ extraction_id: extraction.id })
})
