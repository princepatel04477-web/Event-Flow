'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { PageTitle } from '@/components/ui/PageTitle'
import { CheckCircleIcon } from '@/components/icons'
import { createHotel } from '@/lib/actions/hotels'

interface Props {
  eventId: string
  eventCode: string
  eventName: string
}

// How long to wait before admitting the automatic navigation might not be
// coming. Not a timeout that cancels anything — router.push has no cancel
// API — just the point where staring at "opening…" stops being honest and
// the slow-connection hint appears next to the link that was already there.
const SLOW_NAV_HINT_MS = 4000

export function HotelCreateForm({ eventId, eventCode, eventName }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactMobile, setContactMobile] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Holds the created hotel's id+name once the write lands, so the success
  // view can build a real link — not just a label — the instant it renders.
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null)
  const [slow, setSlow] = useState(false)

  // `router.push()` fetches the destination's RSC payload over the network.
  // On venue Wi-Fi that fetch can stall for a long time, and push has no
  // built-in timeout or escape hatch — once fired, this component had
  // nothing else to show. It waited on "Created — opening…" forever with
  // no link, no retry, nothing to tap. This is that escape hatch: it does
  // not cancel the push (there's nothing to cancel), it just stops
  // pretending the wait is short.
  useEffect(() => {
    if (!created) return
    const t = setTimeout(() => setSlow(true), SLOW_NAV_HINT_MS)
    return () => clearTimeout(t)
  }, [created])

  if (created) {
    const href = `/admin/events/${eventCode}/hotels/${created.id}`
    return (
      <div className="flex flex-col items-center gap-5 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-tint text-ledger-green">
          <CheckCircleIcon className="h-7 w-7" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-fg">{created.name} added</h2>
          <p className="mt-1 text-sm text-muted">
            {slow
              ? 'Still opening — this connection is slow. Tap below whenever you\'re ready.'
              : 'Opening it now…'}
          </p>
        </div>
        {/* A real <Link>, not a second router.push — visible from the first
            frame, not gated behind the slow-connection timer above. The
            automatic push above may still land first; this is what's here
            if it doesn't. */}
        <Link
          href={href}
          className="tap inline-flex min-h-11 w-full max-w-xs items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-brand-fg"
        >
          Open {created.name}
        </Link>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await createHotel(eventId, {
        name, address: address || null, contactName: contactName || null,
        contactMobile: contactMobile || null, notes: notes || null,
      })
      if (result.ok) {
        // Deliberately leaves `submitting` true — the create button stays
        // disabled once `created` is set anyway, since this branch stops
        // rendering the form.
        setCreated({ id: result.hotelId, name })
        router.push(`/admin/events/${eventCode}/hotels/${result.hotelId}`)
        // No router.refresh() here: the destination has no cache entry to
        // invalidate (it's a hotel that didn't exist a moment ago), so this
        // was a second fetch competing for bytes with the push that was
        // already struggling on the same connection, for no benefit.
        return
      }
      setError(result.error ?? 'Failed to create hotel.')
      setSubmitting(false)
    } catch (err: unknown) {
      // A server action can REJECT rather than return — a dropped connection
      // mid-flight is the ordinary cause on venue Wi-Fi. There was no catch
      // here, so the rejection escaped, `setSubmitting(false)` never ran, and
      // the button sat on "Creating…" forever showing nothing at all.
      //
      // The insert commits server-side BEFORE the response is lost, so the
      // hotel may well exist. Saying so matters: the natural response to a
      // stuck button is to press it again, and the retry then fails on the
      // unique (event_id, name) index with "already exists" — which reads as
      // a second, unrelated bug.
      setError(
        `${err instanceof Error ? err.message : 'The request did not complete.'} — ` +
          `the hotel may still have been created. Check the hotel list before adding it again.`,
      )
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <PageTitle>New hotel</PageTitle>

      {error ? (
        <div role="alert" className="rounded-xl bg-tint-danger px-4 py-3 text-sm font-medium text-danger">{error}</div>
      ) : null}

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Hotel name <span className="text-danger">*</span></span>
          <Input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Grand Hyatt" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Address</span>
          <Textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} placeholder="Full address" />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Contact person</span>
            <Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Name" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Contact number</span>
            <Input value={contactMobile} onChange={e => setContactMobile(e.target.value)} type="tel" placeholder="+91 ..." />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Notes</span>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Check-in time, gate close, etc." />
        </label>
      </div>

      {/* bottom-nav, not bottom-0: the tab bar is `fixed bottom-0`, so a bar
          stuck to the viewport bottom sits underneath it and takes the submit
          with it. md:bottom-0 because the tab bar is md:hidden. */}
      <div className="sticky bottom-nav flex items-center gap-3 bg-paper pt-2 pb-2 md:bottom-0 md:pb-safe">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting} className="flex-1">
          {submitting ? 'Creating…' : `Add hotel to ${eventName}`}
        </Button>
      </div>
    </form>
  )
}
