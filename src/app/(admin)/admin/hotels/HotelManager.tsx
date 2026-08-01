'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { createHotel, deleteHotel, updateHotel, type HotelInput } from '@/lib/actions/hotels'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { ChevronDownIcon, PhoneIcon } from '@/components/icons'
import { formatMobile } from '@/lib/phone'

export interface HotelRow {
  id: string
  name: string
  address: string | null
  contact_name: string | null
  contact_mobile: string | null
  notes: string | null
  roomCount: number
  bedCount: number
}

const EMPTY: HotelInput = {
  name: '',
  address: '',
  contactName: '',
  contactMobile: '',
  notes: '',
}

export function HotelManager({
  eventId,
  eventCode,
  hotels,
}: {
  eventId: string
  eventCode: string
  hotels: HotelRow[]
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [values, setValues] = useState<HotelInput>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startCreate() {
    setEditingId(null)
    setValues(EMPTY)
    setError(null)
    setCreating(true)
  }

  function startEdit(hotel: HotelRow) {
    setCreating(false)
    setError(null)
    setEditingId(hotel.id)
    setValues({
      name: hotel.name,
      address: hotel.address ?? '',
      contactName: hotel.contact_name ?? '',
      contactMobile: hotel.contact_mobile ?? '',
      notes: hotel.notes ?? '',
    })
  }

  function cancel() {
    setCreating(false)
    setEditingId(null)
    setError(null)
  }

  async function save() {
    setError(null)
    setBusy(true)
    const result = editingId
      ? await updateHotel(editingId, eventId, eventCode, values)
      : await createHotel(eventId, eventCode, values)
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    cancel()
    router.refresh()
  }

  async function remove(hotel: HotelRow) {
    setError(null)
    setBusy(true)
    const result = await deleteHotel(hotel.id, eventId, eventCode)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  const form = (
    <CardBody className="flex flex-col gap-4">
      <Input
        label="Hotel name"
        required
        value={values.name}
        onChange={(e) => setValues({ ...values, name: e.target.value })}
      />
      <Input
        label="Address"
        value={values.address}
        onChange={(e) => setValues({ ...values, address: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Contact name"
          value={values.contactName}
          onChange={(e) => setValues({ ...values, contactName: e.target.value })}
        />
        <Input
          label="Contact mobile"
          inputMode="tel"
          value={values.contactMobile}
          onChange={(e) => setValues({ ...values, contactMobile: e.target.value })}
        />
      </div>
      <Textarea
        label="Notes"
        rows={2}
        value={values.notes}
        onChange={(e) => setValues({ ...values, notes: e.target.value })}
      />

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button fullWidth onClick={save} loading={busy} disabled={!values.name.trim()}>
          {editingId ? 'Save changes' : 'Add hotel'}
        </Button>
        <Button variant="secondary" onClick={cancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </CardBody>
  )

  return (
    <div className="flex flex-col gap-4">
      {hotels.length === 0 && !creating ? (
        <EmptyState
          title="No hotels yet"
          description="Add the hotels the client has booked, then add their rooms. You need at least one hotel before the backfill can recover rooms from the imported sheet."
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {hotels.map((hotel) => (
          <li key={hotel.id}>
            <Card>
              {editingId === hotel.id ? (
                form
              ) : (
                <CardBody className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-fg">{hotel.name}</p>
                      {hotel.address ? (
                        <p className="mt-0.5 text-sm text-muted">{hotel.address}</p>
                      ) : null}
                      {hotel.contact_name || hotel.contact_mobile ? (
                        <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                          <PhoneIcon className="h-3.5 w-3.5 shrink-0" />
                          {[hotel.contact_name, formatMobile(hotel.contact_mobile)]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      ) : null}
                      {hotel.notes ? (
                        <p className="mt-1 text-sm text-subtle">{hotel.notes}</p>
                      ) : null}
                    </div>
                    <Badge tone={hotel.roomCount > 0 ? 'info' : 'neutral'}>
                      {hotel.roomCount} room{hotel.roomCount === 1 ? '' : 's'}
                    </Badge>
                  </div>

                  {hotel.roomCount > 0 ? (
                    <p className="text-xs text-subtle">{hotel.bedCount} beds in total</p>
                  ) : null}

                  <div className="mt-1 flex flex-wrap gap-2">
                    <Link
                      href={`/admin/hotels/${hotel.id}/rooms?event=${encodeURIComponent(eventCode)}`}
                      className="tap inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-transparent bg-brand px-4 text-base font-semibold text-brand-fg"
                    >
                      Rooms
                    </Link>
                    <Button variant="secondary" onClick={() => startEdit(hotel)} disabled={busy}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => remove(hotel)}
                      disabled={busy}
                      // Blocked server-side too; disabling here explains why
                      // before the tap rather than after.
                      title={
                        hotel.roomCount > 0
                          ? 'Delete the rooms first'
                          : 'Delete this hotel'
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </CardBody>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {error && !creating && editingId === null ? (
        <Card className="border-danger/40 bg-tint-danger">
          <CardBody className="py-3 text-sm font-medium text-danger">{error}</CardBody>
        </Card>
      ) : null}

      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <p className="font-semibold text-fg">New hotel</p>
            </CardTitle>
          </CardHeader>
          {form}
        </Card>
      ) : (
        <Button size="lg" fullWidth variant="secondary" onClick={startCreate} disabled={busy}>
          Add a hotel
        </Button>
      )}

      <Card flat className="border border-dashed border-border">
        <CardBody className="py-3">
          <Link
            href={`/admin/hotels/backfill?event=${encodeURIComponent(eventCode)}`}
            className="tap flex items-center justify-between gap-2"
          >
            <span>
              <span className="block text-sm font-semibold text-fg">
                Recover rooms from the imported sheet
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                Reads the <code>Romm</code> and <code>bed</code> columns already stored from the
                Excel import. No re-upload needed.
              </span>
            </span>
            <ChevronDownIcon className="h-5 w-5 shrink-0 -rotate-90 text-muted" />
          </Link>
        </CardBody>
      </Card>
    </div>
  )
}

export default HotelManager
