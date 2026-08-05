import { NextResponse } from 'next/server'
import { handleWebhook } from '@/lib/actions/messages'

/**
 * POST /api/messages/webhook
 *
 * Receives status callbacks from the WhatsApp BSP. The BSP forwards Meta's
 * webhook format: entry[].changes[].value.statuses[].
 *
 * This route must be public — the BSP cannot authenticate with Supabase.
 * Validation is done inside handleWebhook via parseWebhook(): invalid or
 * irrelevant payloads are silently 200'd so the BSP does not retry.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const result = await handleWebhook(body)
    return NextResponse.json({}, { status: result.status })
  } catch {
    return NextResponse.json({}, { status: 200 })
  }
}
