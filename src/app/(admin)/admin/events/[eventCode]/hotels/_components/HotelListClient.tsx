'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
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
      .then(data => { setHotels(data); setLoading(false) })
      .catch(() => { setError('Could not load hotels.'); setLoading(false) })
  }, [eventId])

  async function handleDelete(hotelId: string) {
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
            <div key={hotel.id} className="group relative">
              <Link
                href={`/admin/events/${eventCode}/hotels/${hotel.id}`}
                className="tap flex items-center gap-3 rounded-xl border border-rule bg-surface p-4 transition-colors hover:bg-surface-2 active:bg-surface-2"
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
                onClick={e => { e.preventDefault(); void handleDelete(hotel.id) }}
                disabled={deleting === hotel.id}
                aria-label={`Delete ${hotel.name}`}
                className="tap absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg text-muted opacity-0 transition-opacity hover:bg-tint-danger hover:text-danger group-hover:opacity-100"
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
