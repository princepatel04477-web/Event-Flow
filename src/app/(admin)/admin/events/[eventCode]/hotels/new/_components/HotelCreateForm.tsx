'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { PageTitle } from '@/components/ui/PageTitle'
import { createHotel } from '@/lib/actions/hotels'

interface Props {
  eventId: string
  eventCode: string
  eventName: string
}

export function HotelCreateForm({ eventId, eventCode, eventName }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactMobile, setContactMobile] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Distinct from `submitting` so the button can say "Created — opening…"
  // rather than sitting on "Creating…" while the RSC navigation is in flight.
  // The write is already durable at that point and the label should say so.
  const [created, setCreated] = useState(false)

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
        // Deliberately leaves `submitting` true — navigation is in flight and
        // re-enabling the button here invites a duplicate insert.
        setCreated(true)
        router.push(`/admin/events/${eventCode}/hotels/${result.hotelId}`)
        router.refresh()
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
          {created ? 'Created — opening…' : submitting ? 'Creating…' : `Add hotel to ${eventName}`}
        </Button>
      </div>
    </form>
  )
}
