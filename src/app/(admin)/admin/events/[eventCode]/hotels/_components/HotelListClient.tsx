'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageTitle } from '@/components/ui/PageTitle'
import { PlusIcon, BuildingIcon, ChevronRightIcon } from '@/components/icons'
import { readHotelList, type HotelListItem } from '@/lib/actions/hotels-list'
import { deleteHotel } from '@/lib/actions/hotels'

interface Props {
  eventId: string
  eventCode: string
}

export function HotelListClient({ eventId, eventCode }: Props) {
  const [hotels, setHotels] = useState<HotelListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    readHotelList(eventId)
      .then(res => {
        if (res.ok) setHotels(res.hotels)
        // A refusal is not an empty list. Showing "No hotels yet" for a read
        // this session was not allowed to make is how an existing hotel reads
        // as a missing one.
        else setError(res.error)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not load hotels.')
        setLoading(false)
      })
  }, [eventId])

  async function handleDelete(hotelId: string, hotelName: string) {
    // There was no confirmation here at all, and the button that called it was
    // invisible on a touch device (see the row markup below). Deleting a hotel
    // is not recoverable from this screen.
    if (!window.confirm(`Delete ${hotelName}?\n\nIts rooms go with it. This cannot be undone.`)) {
      return
    }
    setDeleting(hotelId)
    const result = await deleteHotel(hotelId, eventId)
    if (result.ok) {
      setHotels(h => h.filter(h => h.id !== hotelId))
    } else {
      alert(result.error)
    }
    setDeleting(null)
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <div className="h-7 w-28 rounded-md bg-rule-strong" />
        <div className="h-20 rounded-xl bg-surface" />
        <div className="h-20 rounded-xl bg-surface" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        title="Could not load hotels"
        description={error}
        action={<Button onClick={() => window.location.reload()}>Retry</Button>}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <PageTitle>Hotels</PageTitle>
        <Link href={`/admin/events/${eventCode}/hotels/new`}>
          <Button variant="primary" leadingIcon={<PlusIcon className="h-5 w-5" />} size="md">
            Add hotel
          </Button>
        </Link>
      </div>

      {hotels.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon className="h-7 w-7" />}
          title="No hotels yet"
          description="Add the first hotel for this event to start managing rooms."
          action={
            <Link href={`/admin/events/${eventCode}/hotels/new`}>
              <Button variant="primary" leadingIcon={<PlusIcon className="h-5 w-5" />} fullWidth>
                Add hotel
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {hotels.map(hotel => (
            /* The delete button was `absolute top-3 right-3` with
               `opacity-0 group-hover:opacity-100`, overlaying the Link. A phone
               has no hover, so it was permanently invisible — but opacity does
               not stop pointer events, so it was still tappable. Tapping the
               top-right of a hotel card silently deleted it, with no
               confirmation. It is now a real sibling control: visible, 44px,
               outside the Link, and it asks first. */
            <div key={hotel.id} className="flex items-center rounded-xl border border-rule bg-surface">
              <Link
                href={`/admin/events/${eventCode}/hotels/${hotel.id}`}
                className="tap flex min-w-0 flex-1 items-center gap-3 rounded-l-xl p-4 transition-colors hover:bg-surface-2 active:bg-surface-2"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand">
                  <BuildingIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-fg truncate">{hotel.name}</p>
                  <p className="text-sm text-muted">
                    {hotel.roomCount} room{hotel.roomCount === 1 ? '' : 's'}
                    {hotel.occupiedCount > 0 ? ` · ${hotel.occupiedCount} occupied` : ''}
                  </p>
                </div>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
              </Link>
              <button
                type="button"
                onClick={() => void handleDelete(hotel.id, hotel.name)}
                disabled={deleting === hotel.id}
                aria-label={`Delete ${hotel.name}`}
                className="tap mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-tint-danger hover:text-danger active:bg-tint-danger active:text-danger disabled:opacity-40"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
