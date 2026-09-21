'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'

const RSVP_INSTRUCTIONS = `You are a polite wedding RSVP assistant calling on behalf of the wedding team.
Speak simple Hindi and English. Ask: Are they coming? How many guests? Arrival date, time, and how they travel (flight, train, or car)?
Never guess flight numbers — if unclear, leave blank.
When you have the facts, call save_rsvp_draft. If they want a human, call request_human.`

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
    setLog((prev) => [...prev.slice(-6), line])
  }, [])

  async function saveDraft(parsed: Record<string, unknown>) {
    const res = await fetch('/api/grok-voice/save-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, parsed }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      appendLog('Could not save — try again or use Call by hand.')
      return
    }
    appendLog('Saved. Open Call notes to check and confirm.')
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
        appendLog('Voice test is not set up on this server yet. Use Call by hand for now.')
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
        appendLog('Listening — speak as if you are the guest.')
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
                description: 'Save RSVP facts from the conversation',
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
            appendLog('Guest wants a person — use Call by hand.')
          }
        } catch {
          // ignore
        }
      }

      ws.onerror = () => {
        setState('error')
        appendLog('Connection failed. Check Wi‑Fi and try again.')
      }

      ws.onclose = () => {
        setState('ended')
        appendLog('Ended.')
        wsRef.current = null
      }
    } catch {
      setState('error')
      appendLog('Could not start. Check Wi‑Fi and try again.')
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
        <p className="text-sm text-muted">
          Practice before calling real guests. What you save appears under{' '}
          <Link href={`/${eventCode}/rsvp/review`} className="text-brand underline">
            Call notes
          </Link>
          .
        </p>
        {!configured ? (
          <p className="text-sm text-muted">
            Auto-calling from the server is not turned on yet. You can still call families by hand.
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            size="lg"
            onClick={startTest}
            disabled={!configured || state === 'connecting' || state === 'live'}
            loading={state === 'connecting'}
          >
            {state === 'live' ? 'Listening…' : 'Start practice call'}
          </Button>
          {state === 'live' ? (
            <Button size="lg" variant="secondary" onClick={stopTest}>
              Stop
            </Button>
          ) : null}
        </div>
        {log.length ? (
          <ul className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  )
}
