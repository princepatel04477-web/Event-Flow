import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { handleWebhook } from '@/lib/actions/messages'

function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false
  if (signatureHeader === secret) return true
  try {
    const expectedHash = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const sig = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedHash, 'hex'))
  } catch {
    return false
  }
}

/**
 * POST /api/messages/webhook
 *
 * Receives status callbacks from the WhatsApp BSP. The BSP forwards Meta's
 * webhook format: entry[].changes[].value.statuses[].
 */
export async function POST(req: Request) {
  const secret =
    process.env.MESSAGES_WEBHOOK_SECRET ??
    process.env.BSP_WEBHOOK_SECRET ??
    process.env.WHATSAPP_WEBHOOK_SECRET

  let rawBody = ''
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Cannot read body' }, { status: 400 })
  }

  if (secret) {
    const signature =
      req.headers.get('x-hub-signature-256') ??
      req.headers.get('x-webhook-secret') ??
      req.headers.get('x-signature')
    if (!verifySignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 })
  }

  try {
    const result = await handleWebhook(body)
    return NextResponse.json({}, { status: result.status })
  } catch {
    return NextResponse.json({ error: 'Failed to process webhook' }, { status: 500 })
  }
}
