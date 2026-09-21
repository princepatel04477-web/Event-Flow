import { NextResponse } from 'next/server'

/**
 * Mint a short-lived client token for the Grok Voice Agent WebSocket.
 * The browser never sees XAI_API_KEY — only this ephemeral credential.
 */
export async function POST() {
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
