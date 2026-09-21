import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Place one outbound RSVP call via Voximplant (when configured).
 * Streams audio to Grok Voice Agent on the telephony side.
 *
 * Required secrets:
 *   VOXIMPLANT_ACCOUNT_ID, VOXIMPLANT_API_KEY, VOXIMPLANT_RULE_ID
 *   XAI_API_KEY (used by the Voximplant scenario, not here)
 */
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const webhookSecret = Deno.env.get('OUTBOUND_WEBHOOK_SECRET') ?? ''

const voxAccount = Deno.env.get('VOXIMPLANT_ACCOUNT_NAME') ?? ''
const voxApiKey = Deno.env.get('VOXIMPLANT_API_KEY') ?? ''
const voxAppId = Deno.env.get('VOXIMPLANT_APPLICATION_ID') ?? ''
const voxRuleId = Deno.env.get('VOXIMPLANT_OUTBOUND_RULE_ID') ?? ''

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

  let body: { job_id?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (!body.job_id) {
    return Response.json({ error: 'job_id required' }, { status: 400 })
  }

  const { data: job, error: jobErr } = await db
    .from('rsvp_campaign_jobs')
    .select('id, event_id, group_id, campaign_id, dial_attempts')
    .eq('id', body.job_id)
    .maybeSingle()

  if (jobErr || !job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  const { data: group } = await db
    .from('guest_groups')
    .select('head_name, primary_mobile')
    .eq('id', job.group_id)
    .maybeSingle()

  const mobile = group?.primary_mobile
  if (!mobile || mobile.length < 10) {
    await db.from('rsvp_campaign_jobs').update({
      status: 'failed',
      error_text: 'no_valid_mobile',
    }).eq('id', job.id)
    return Response.json({ error: 'No valid mobile on family' }, { status: 400 })
  }

  const e164 = mobile.startsWith('+') ? mobile : `+91${mobile.replace(/\D/g, '').slice(-10)}`

  await db.from('rsvp_campaign_jobs').update({
    status: 'ringing',
    dial_attempts: (job.dial_attempts ?? 0) + 1,
    last_dialed_at: new Date().toISOString(),
  }).eq('id', job.id)

  if (!voxAccount || !voxApiKey || !voxAppId || !voxRuleId) {
    return Response.json({
      queued: true,
      job_id: job.id,
      to: e164,
      message: 'Voximplant not configured — job marked ringing for manual follow-up',
    })
  }

  const params = new URLSearchParams({
    account_name: voxAccount,
    api_key: voxApiKey,
    application_id: voxAppId,
    rule_id: voxRuleId,
    script_custom_data: JSON.stringify({
      clientNum: e164,
      jobId: job.id,
      eventId: job.event_id,
      groupId: job.group_id,
      headName: group?.head_name ?? '',
    }),
  })

  const voxRes = await fetch(
    `https://api.voximplant.com/platform_api/StartScenarios/?${params}`,
    { method: 'POST' },
  )

  if (!voxRes.ok) {
    const text = await voxRes.text()
    await db.from('rsvp_campaign_jobs').update({
      status: 'failed',
      error_text: text.slice(0, 500),
    }).eq('id', job.id)
    return Response.json({ error: 'Voximplant start failed', detail: text.slice(0, 200) }, { status: 502 })
  }

  const voxBody = await voxRes.json()
  return Response.json({ started: true, job_id: job.id, vox: voxBody })
})
