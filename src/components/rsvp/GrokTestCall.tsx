'use client'

import { useCallback, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'

const RSVP_INSTRUCTIONS = `You are a polite wedding RSVP assistant calling on behalf of the Sharma family wedding team.
Speak simple Hindi and English. Ask: Are they coming? How many guests? Arrival date, time, and mode (flight, train, or car)?
Never guess flight numbers — if unclear, leave blank and say you will note it for follow-up.
When you have the facts, call save_rsvp_draft with the structured data. If they want a human, call request_human.`

type SessionState = 'idle' | 'connecting' | 'live' | 'ended' | 'error'

export function GrokTestCall({
  eventId,
  eventCode,
  configured,
}: {
  eventId: string
  eventCode: string
  configured: boolean
}) {
  const [state, setState] = useState<SessionState>('idle')
  const [log, setLog] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-8), line])
  }, [])

  async function saveDraft(parsed: Record<string, unknown>) {
    const res = await fetch('/api/grok-voice/save-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, parsed }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      appendLog(`Save failed: ${body.error ?? res.status}`)
      return
    }
    appendLog(`Draft saved — review in Call notes`)
  }

  async function startTest() {
    if (state === 'connecting' || state === 'live') return
    setState('connecting')
    setLog([])

    try {
      const tokenRes = await fetch('/api/grok-voice/ephemeral', { method: 'POST' })
      const tokenBody = await tokenRes.json()
      if (!tokenRes.ok) {
        setState('error')
        appendLog(tokenBody.error ?? 'Could not start voice session')
        return
      }

      const url = `${tokenBody.url}?model=${encodeURIComponent(tokenBody.model)}`
      const ws = new WebSocket(url, [
        'realtime',
        `openai-insecure-api-key.${tokenBody.token}`,
      ])
      wsRef.current = ws

      ws.onopen = () => {
        setState('live')
        appendLog('Connected — speak into your microphone')
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            voice: 'eve',
            instructions: RSVP_INSTRUCTIONS,
            turn_detection: { type: 'server_vad' },
            tools: [
              {
                type: 'function',
                name: 'save_rsvp_draft',
                description: 'Save structured RSVP facts from the conversation',
                parameters: {
                  type: 'object',
                  properties: {
                    rsvp_status: { type: 'string' },
                    confirmed_pax: { type: 'number' },
                    arrival: { type: 'object' },
                    departure: { type: 'object' },
                    special_requests: { type: 'string' },
                  },
                },
              },
              {
                type: 'function',
                name: 'request_human',
                description: 'Guest asked for a human caller',
                parameters: { type: 'object', properties: {} },
              },
            ],
          },
        }))
      }

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            type?: string
            name?: string
            arguments?: string
          }
          if (msg.type === 'response.function_call_arguments.done' && msg.name === 'save_rsvp_draft') {
            const args = JSON.parse(msg.arguments ?? '{}') as Record<string, unknown>
            await saveDraft({
              rsvp_status: args.rsvp_status ?? null,
              confirmed_pax: args.confirmed_pax ?? null,
              arrival: args.arrival ?? null,
              departure: args.departure ?? null,
              special_requests: args.special_requests ?? null,
            })
          }
          if (msg.type === 'response.function_call_arguments.done' && msg.name === 'request_human') {
            appendLog('Guest requested a human — use Manual calls')
          }
        } catch {
          // ignore parse errors on ancillary events
        }
      }

      ws.onerror = () => {
        setState('error')
        appendLog('WebSocket error — check API key and network')
      }

      ws.onclose = () => {
        setState('ended')
        appendLog('Session ended')
        wsRef.current = null
      }
    } catch (err) {
      setState('error')
      appendLog(err instanceof Error ? err.message : 'Failed to connect')
    }
  }

  function stopTest() {
    wsRef.current?.close()
    wsRef.current = null
    setState('ended')
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Test the voice agent</h2>
          <p className="text-xs text-muted">
            Try a browser call before dialing guests. Uses Grok Voice — no phone bill.
            Saved notes appear under{' '}
            <a href={`/${eventCode}/rsvp/review`} className="text-brand underline">Call notes</a>.
          </p>
        </div>
        {!configured ? (
          <p className="text-sm text-warning">
            Set <code className="text-xs">XAI_API_KEY</code> on the server to enable voice tests.
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            size="md"
            onClick={startTest}
            disabled={!configured || state === 'connecting' || state === 'live'}
            loading={state === 'connecting'}
          >
            {state === 'live' ? 'Live…' : 'Start test call'}
          </Button>
          {state === 'live' ? (
            <Button size="md" variant="secondary" onClick={stopTest}>
              End
            </Button>
          ) : null}
        </div>
        {log.length ? (
          <ul className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  )
}
