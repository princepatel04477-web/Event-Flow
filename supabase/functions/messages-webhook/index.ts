/**
 * POST /functions/v1/messages-webhook
 *
 * WhatsApp BSP status callbacks. Ported from src/app/api/messages/webhook/route.ts,
 * which could not survive M2: `output: 'export'` has no request layer, so a
 * public POST endpoint cannot live in the Next app any more.
 *
 * ⚠️ NOT DEPLOYED YET, AND THE BSP STILL POINTS AT THE OLD URL.
 * Two steps before messaging can go live:
 *   1. npx supabase functions deploy messages-webhook --no-verify-jwt
 *   2. Repoint the BSP's webhook URL from
 *        https://<host>/api/messages/webhook
 *      to
 *        https://xktxnkuzplhzxkevwrcj.supabase.co/functions/v1/messages-webhook
 * Until both are done, delivery receipts are silently dropped. That is survivable
 * only because messaging is not live: `messages` currently holds 0 rows. It stops
 * being survivable the moment the first template is sent.
 *
 * `--no-verify-jwt` is REQUIRED and is not laziness: the BSP is a third party
 * that cannot hold a Supabase session. Because the endpoint is therefore
 * unauthenticated, two things follow and neither is optional:
 *
 *  - It runs on the SERVICE ROLE, so RLS cannot constrain it. Its restraint is
 *    that it touches exactly one table and one column set, keyed on a
 *    provider-issued id it cannot forge a match for. Same posture as
 *    transcribe-recording (see CLAUDE.md §9) — enforced by review, not by
 *    grants. Making it a hard guarantee means a dedicated database role.
 *  - It answers 200 to anything it does not recognise. A BSP that gets a 4xx
 *    retries, and a retry storm against an unauthenticated endpoint is a
 *    self-inflicted outage. Only a genuine write failure returns 500, which is
 *    the one case where a retry is actually wanted.
 *
 * It deliberately CANNOT create messages — only update one whose
 * provider_message_id already exists. An unmatched id is a no-op, so a
 * malicious caller cannot inject rows.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed'

interface WebhookStatus {
  providerMessageId: string
  status: MessageStatus
  error?: string
  timestamp: string
}

/** Meta's status vocabulary → ours. Unknown values degrade to 'sent'. */
function mapMetaStatus(metaStatus: string): MessageStatus {
  switch (metaStatus) {
    case 'sent':
      return 'sent'
    case 'delivered':
      return 'delivered'
    case 'read':
      return 'read'
    case 'failed':
      return 'failed'
    default:
      return 'sent'
  }
}

/**
 * Parse the BSP payload (Meta's shape: entry[].changes[].value.statuses[]).
 *
 * A verbatim port of parseBspWebhook() in src/lib/messaging/provider.ts. Kept
 * as a copy rather than shared, because an Edge Function is a separate Deno
 * deployment and cannot import from src/. If the Next-side parser changes,
 * THIS MUST CHANGE TOO — they are the same contract in two runtimes.
 *
 * Returns null for anything irrelevant, including Meta's health checks.
 */
function parseBspWebhook(body: unknown): WebhookStatus | null {
  const b = body as Record<string, unknown> | null
  if (!b) return null

  const entry = b.entry as Array<Record<string, unknown>> | undefined
  if (!entry?.[0]) return null

  const changes = entry[0].changes as Array<Record<string, unknown>> | undefined
  if (!changes?.[0]) return null

  const value = changes[0].value as Record<string, unknown> | undefined
  if (!value) return null

  const statuses = value.statuses as Array<Record<string, unknown>> | undefined
  if (!statuses?.[0]) {
    // Might be an inbound-message event rather than a status change.
    const messages = value.messages as Array<Record<string, unknown>> | undefined
    if (messages?.[0]) {
      return {
        providerMessageId: (messages[0].id as string) ?? '',
        status: 'sent',
        timestamp: (value.timestamp as string) ?? new Date().toISOString(),
      }
    }
    return null
  }

  const s = statuses[0]
  const errors = s.errors as Array<Record<string, unknown>> | undefined

  return {
    providerMessageId: (s.id as string) ?? '',
    status: mapMetaStatus(s.status as string),
    error: Array.isArray(errors) && errors.length > 0
      ? (errors[0].message as string)
      : undefined,
    timestamp: (s.timestamp as string) ?? new Date().toISOString(),
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    // Malformed JSON is not worth a retry.
    return new Response('ok', { status: 200 })
  }

  const status = parseBspWebhook(body)
  // Health check or an event we do not care about.
  if (!status) return new Response('ok', { status: 200 })

  // An empty provider id would match every row with a null id — refuse rather
  // than issue an unbounded update.
  if (!status.providerMessageId) return new Response('ok', { status: 200 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { error } = await supabase
    .from('messages')
    .update({
      status: status.status,
      ...(status.status === 'sent' ? { sent_at: status.timestamp } : {}),
      ...(status.status === 'delivered' ? { delivered_at: status.timestamp } : {}),
      ...(status.status === 'read' ? { read_at: status.timestamp } : {}),
      ...(status.status === 'failed' && status.error ? { error: status.error } : {}),
    })
    .eq('provider_message_id', status.providerMessageId)

  // The ONLY case that earns a retry.
  if (error) {
    console.error('[messages-webhook] update failed', error.message)
    return new Response('error', { status: 500 })
  }

  return new Response('ok', { status: 200 })
})
