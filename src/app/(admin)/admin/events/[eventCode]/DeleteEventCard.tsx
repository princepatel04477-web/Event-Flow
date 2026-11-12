'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { deleteEvent } from '@/lib/actions/events'
import { lostResponseMessage } from '@/lib/errors'

/**
 * Permanently delete an event (admin-only).
 *
 * Lives beside ArchiveEventCard on the per-event admin screens (desktop admin
 * dashboard and mobile Control tab) so an admin must have opened the specific
 * event and typed its exact name before destroying it.
 */
export function DeleteEventCard({
  eventId,
  eventName,
  eventCode,
}: {
  eventId: string
  eventName: string
  eventCode: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = typed.trim().toLowerCase() === eventName.trim().toLowerCase()

  async function handleDelete() {
    setPending(true)
    setError(null)
    try {
      const res = await deleteEvent(eventId, typed)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setOpen(false)
      setTyped('')
      router.push('/admin/events')
      router.refresh()
    } catch {
      setError(lostResponseMessage('the events list'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="border-ledger-red/30">
      <CardBody className="flex flex-col gap-3">
        <div>
          <p className="font-semibold text-ledger-red">Delete this event permanently</p>
          <p className="mt-0.5 text-sm text-muted">
            Removes {eventName} and all of its guests, call records, rooms, deliveries, and
            staff. This cannot be undone.
          </p>
        </div>

        {!open ? (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Delete {eventCode}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              label="Type the event name to confirm deletion"
              hint={
                <>
                  Exactly as written above: <strong>{eventName}</strong>
                </>
              }
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />

            {error ? (
              <p role="alert" className="text-sm font-medium text-ledger-red">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col gap-2">
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={!matches}
                loading={pending}
              >
                Permanently delete {eventCode}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false)
                  setTyped('')
                  setError(null)
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
