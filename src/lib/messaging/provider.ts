/**
 * WhatsApp message provider interface.
 *
 * One file to swap when the provider changes. Nothing outside this module
 * knows or cares which BSP is on the other side. Credentials are read from
 * environment once at construction, never passed to client code.
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface MessageSendInput {
  /** E.164 phone number. */
  to: string
  /** Template key from message_templates.key */
  templateKey: string
  /** {{placeholder}} → value map. Body-only; no header/footer vars. */
  vars: Record<string, string>
  /** The event_id for audit context. */
  eventId: string
  /** The group_id so the messages table can link back. */
  groupId?: string
}

export interface MessageSendResult {
  ok: true
  providerMessageId: string
}

export interface MessageSendError {
  ok: false
  error: string
  code: 'provider_error' | 'config_error' | 'rate_limited' | 'invalid_number'
}

export interface WebhookStatus {
  /** The provider's message id. */
  providerMessageId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  error?: string
  /** ISO timestamp from the provider. */
  timestamp: string
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface MessageProvider {
  /** Send a single WhatsApp template message. */
  send(input: MessageSendInput): Promise<MessageSendResult | MessageSendError>

  /**
   * Parse and validate an incoming status webhook payload.
   * Returns null for payloads this provider does not care about (health checks, etc).
   */
  parseWebhook(body: unknown): WebhookStatus | null
}

// ---------------------------------------------------------------------------
// Concrete: WhatsApp Cloud API via Indian BSP
//
// Built for the Interakt / AiSensy / Gupshup pattern where the BSP wraps
// Meta's Cloud API and exposes a simpler key-based REST endpoint.
//
// Environment:
//   WHATSAPP_API_URL   — BSP API base (default https://cloud-api.interakt.ai)
//   WHATSAPP_API_KEY   — BSP API key
//   WHATSAPP_PHONE_ID  — WABA phone number ID
// ---------------------------------------------------------------------------

const API_URL = process.env.WHATSAPP_API_URL ?? 'https://cloud-api.interakt.ai'
const API_KEY = process.env.WHATSAPP_API_KEY ?? ''
const PHONE_ID = process.env.WHATSAPP_PHONE_ID ?? ''

function checkConfig(): { ok: true } | { ok: false; error: string } {
  if (!API_KEY) return { ok: false, error: 'WHATSAPP_API_KEY not set' }
  if (!PHONE_ID) return { ok: false, error: 'WHATSAPP_PHONE_ID not set' }
  return { ok: true }
}

interface BspSendPayload {
  countryCode: string
  phoneNumber: string
  type: 'Template'
  template: {
    name: string
    languageCode: string
    bodyValues: string[]
  }
}

interface BspResponse {
  result?: string
  id?: string
  error?: { message: string; code?: number }
}

function parsePhone(to: string): { countryCode: string; phoneNumber: string } | null {
  // Accept +91XXXXXXXXXX or 91XXXXXXXXXX
  const match = to.match(/^\+?(\d{1,3})(\d{10})$/)
  if (!match) return null
  return { countryCode: match[1], phoneNumber: match[2] }
}

export async function sendBsp(input: MessageSendInput): Promise<MessageSendResult | MessageSendError> {
  const configCheck = checkConfig()
  if (!configCheck.ok) return { ok: false, error: configCheck.error, code: 'config_error' }

  const parsed = parsePhone(input.to)
  if (!parsed) {
    return { ok: false, error: `Invalid number: ${input.to}`, code: 'invalid_number' }
  }

  const bodyValues = Object.values(input.vars)

  const payload: BspSendPayload = {
    countryCode: parsed.countryCode,
    phoneNumber: parsed.phoneNumber,
    type: 'Template',
    template: {
      name: input.templateKey,
      languageCode: 'en',
      bodyValues,
    },
  }

  try {
    const res = await fetch(`${API_URL}/api/v1/message`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const json = (await res.json()) as BspResponse

    if (!res.ok || json.error) {
      const code = res.status === 429 ? 'rate_limited' : 'provider_error'
      return {
        ok: false,
        error: json.error?.message ?? `HTTP ${res.status}`,
        code: code as MessageSendError['code'],
      }
    }

    const providerMessageId = json.id ?? json.result ?? `sent-${Date.now()}`
    return { ok: true, providerMessageId }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown provider error',
      code: 'provider_error',
    }
  }
}

/**
 * Parse a Meta-style webhook payload. Interakt and most BSPs forward Meta's
 * webhook format: entry[].changes[].value.statuses[].
 */
export function parseBspWebhook(body: unknown): WebhookStatus | null {
  const b = body as Record<string, unknown>
  if (!b) return null

  const entry = b.entry as Array<Record<string, unknown>> | undefined
  if (!entry?.[0]) return null

  const changes = entry[0].changes as Array<Record<string, unknown>> | undefined
  if (!changes?.[0]) return null

  const value = changes[0].value as Record<string, unknown> | undefined
  if (!value) return null

  const statuses = value.statuses as Array<Record<string, unknown>> | undefined
  if (!statuses?.[0]) {
    // Might be a message event — check for messages array
    const messages = value.messages as Array<Record<string, unknown>> | undefined
    if (messages?.[0]) {
      return {
        providerMessageId: (messages[0].id as string) ?? '',
        status: 'sent',
        timestamp: value.timestamp as string ?? new Date().toISOString(),
      }
    }
    return null
  }

  const s = statuses[0]
  const status = mapMetaStatus(s.status as string)

  return {
    providerMessageId: (s.id as string) ?? '',
    status,
    error: s.errors && Array.isArray(s.errors) && s.errors.length > 0
      ? (s.errors as Array<Record<string, unknown>>)[0].message as string
      : undefined,
    timestamp: (s.timestamp as string) ?? new Date().toISOString(),
  }
}

function mapMetaStatus(metaStatus: string): WebhookStatus['status'] {
  switch (metaStatus) {
    case 'sent': return 'sent'
    case 'delivered': return 'delivered'
    case 'read': return 'read'
    case 'failed': return 'failed'
    default: return 'sent'
  }
}

/**
 * The provider instance. Swap the implementation here when the provider changes.
 */
export const provider: MessageProvider = {
  send: sendBsp,
  parseWebhook: parseBspWebhook,
}
