import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/server'
import { getEventAccess } from '@/lib/supabase/queries'

const bodySchema = z.object({
  eventId: z.string().uuid().optional(),
})

/**
 * Mint a short-lived client token for the Grok Voice Agent WebSocket.
 * The browser never sees XAI_API_KEY — only this ephemeral credential.
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

  let eventId = claims?.eventId
  try {
    const raw = await req.json()
    const parsed = bodySchema.safeParse(raw)
    if (parsed.success && parsed.data.eventId) {
      eventId = parsed.data.eventId
    }
  } catch {
    // Body is optional if claims has eventId
  }

  if (!eventId) {
    return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
  }

  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (claims && claims.eventId !== eventId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'XAI_API_KEY is not configured on the server.' },
      { status: 503 },
    )
  }

  try {
    const res = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: { seconds: 300 },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: `xAI token request failed: ${text.slice(0, 200)}` },
        { status: 502 },
      )
    }

    const data = (await res.json()) as { client_secret?: { value?: string } }
    const token = data.client_secret?.value
    if (!token) {
      return NextResponse.json({ error: 'No client secret returned' }, { status: 502 })
    }

    return NextResponse.json({
      token,
      model: 'grok-voice-latest',
      url: 'wss://api.x.ai/v1/realtime',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
