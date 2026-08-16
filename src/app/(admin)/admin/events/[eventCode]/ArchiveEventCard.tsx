'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { archiveEvent, unarchiveEvent } from '@/lib/actions/events'

/**
 * Archive an event, or restore an archived one.
 *
 * THE CONTROL IS HERE AND NOT ON THE EVENTS LIST, on purpose. On a list of
 * events every row looks like every other row, and the failure this whole
 * screen guards against is acting on the wrong one — the same class of
 * accident as a script that wrote to the wrong `event_id`. Reaching this
 * button means having navigated into one event and read its name and code at
 * the top of the page, then typed that name back. Three separate confirmations
 * that the row on screen is the row intended.
 *
 * There is no delete. `delivery_proofs.event_id` is ON DELETE RESTRICT with an
 * unconditional block_mutation() delete trigger, so an event that has recorded
 * a proof cannot be deleted by anyone — an admin, or the service role. See
 * migration 20260816120000.
 */
export function ArchiveEventCard({
  eventId,
  eventName,
  eventCode,
  archivedAt,
}: {
  eventId: string
  eventName: string
  eventCode: string
  archivedAt: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Mirrors the server's comparison exactly. Client-side this only enables the
  // button; `archiveEvent` re-reads the name from the database and checks it
  // again, because a disabled button is styling, not a guard.
  const matches = typed.trim().toLowerCase() === eventName.trim().toLowerCase()

  async function handleArchive() {
    setPending(true)
    setError(null)
    const res = await archiveEvent(eventId, typed)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    setTyped('')
    router.push('/admin/events')
    router.refresh()
  }

  async function handleRestore() {
    setPending(true)
    setError(null)
    const res = await unarchiveEvent(eventId)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.refresh()
  }

  if (archivedAt) {
    return (
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div>
            <p className="font-semibold text-fg">This event is archived</p>
            <p className="mt-0.5 text-sm text-muted">
              Archived on{' '}
              {new Date(archivedAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              . It is hidden from the events list, and nothing in it has been
              deleted — every guest, room, hamper and photo proof is exactly where
              it was.
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}

          <Button variant="secondary" onClick={handleRestore} loading={pending}>
            Restore to the events list
          </Button>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div>
          <p className="font-semibold text-fg">Archive this event</p>
          <p className="mt-0.5 text-sm text-muted">
            Hides {eventName} from the events list. Nothing is deleted and it can
            be restored at any time — this is a filter on what you see, not a
            removal.
          </p>
        </div>

        {!open ? (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Archive {eventCode}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              label="Type the event name to confirm"
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
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col gap-2">
              <Button
                variant="danger"
                onClick={handleArchive}
                disabled={!matches}
                loading={pending}
              >
                Archive this event
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
