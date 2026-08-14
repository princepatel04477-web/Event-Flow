'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { UserIcon } from '@/components/icons'
import { createStaffMember, setStaffMemberActive } from '@/lib/actions/staff'

export type StaffRow = {
  id: string
  fullName: string
  isActive: boolean
}

/**
 * The staff list for one event.
 *
 * Deliberately the plainest screen in the admin area: a text box, a button,
 * and a list. It exists because its absence broke every write in the product,
 * not because anyone needs to manage staff richly. Resist adding roles,
 * phone numbers or shifts here — `app.event_role` is exactly
 * ('event_team', 'client') and a finer split needs an enum value plus new RLS
 * (see CLAUDE.md §10), not a column on this form.
 */
export function StaffClient({
  eventId,
  eventCode,
  eventName,
  rows,
  loadError,
}: {
  eventId: string
  eventCode: string
  eventName: string
  rows: StaffRow[]
  loadError: string | null
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const activeCount = rows.filter((r) => r.isActive).length

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return

    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name.')
      return
    }

    setError(null)
    startTransition(async () => {
      const res = await createStaffMember(eventId, eventCode, trimmed)
      if (!res.ok) {
        setError(res.error)
        return
      }
      // Clear only on success — a refused name stays in the box so it does
      // not have to be retyped one-handed.
      setName('')
    })
  }

  function handleToggle(row: StaffRow) {
    if (pending) return

    if (
      row.isActive &&
      !window.confirm(
        `Remove ${row.fullName} from the pick-a-name list?\n\n` +
          'Anything they have already done stays recorded against them. ' +
          'They can be put back at any time.',
      )
    ) {
      return
    }

    setError(null)
    setBusyId(row.id)
    startTransition(async () => {
      const res = await setStaffMemberActive(row.id, eventCode, !row.isActive)
      setBusyId(null)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/admin/events/${eventCode}`} className="text-sm text-muted underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-fg">Staff</h1>
        <p className="mt-1 text-sm text-muted">
          Who can log calls, allocate rooms and take delivery photos on {eventName}. Each
          person taps their own name after entering the team code, so every write is
          recorded against a human.
        </p>
      </div>

      {activeCount === 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-rule bg-tint-warning px-4 py-3 text-sm font-medium text-warning"
        >
          Nobody is on this list. The event works — calls, rooms, imports and photos all
          save — but none of them will say who did it. Adding names here is the only way
          to get that back; it cannot be filled in afterwards.
        </div>
      ) : null}

      {loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-ledger-red bg-red-tint px-4 py-3 text-sm font-medium text-ledger-red"
        >
          Could not load the staff list: {loadError}
        </div>
      ) : null}

      <Card>
        <CardBody>
          <form onSubmit={handleAdd} className="flex flex-col gap-3">
            <Input
              label="Add someone"
              placeholder="Full name"
              hint="As they would introduce themselves on the phone."
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={error}
              autoComplete="off"
              maxLength={80}
            />
            <Button type="submit" loading={pending && busyId === null} fullWidth>
              Add to event
            </Button>
          </form>
        </CardBody>
      </Card>

      {rows.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Card edge={row.isActive ? 'active' : 'neutral'}>
                <CardBody className="flex items-center gap-3 py-3">
                  <UserIcon
                    className={row.isActive ? 'h-5 w-5 shrink-0 text-muted' : 'h-5 w-5 shrink-0 text-subtle'}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        row.isActive
                          ? 'truncate font-semibold text-fg'
                          : 'truncate font-semibold text-muted'
                      }
                    >
                      {row.fullName}
                    </p>
                    {!row.isActive ? (
                      <p className="text-xs text-subtle">Not on the pick list</p>
                    ) : null}
                  </div>
                  <Button
                    variant={row.isActive ? 'secondary' : 'primary'}
                    onClick={() => handleToggle(row)}
                    loading={busyId === row.id}
                    disabled={pending && busyId !== row.id}
                  >
                    {row.isActive ? 'Remove' : 'Put back'}
                  </Button>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs leading-relaxed text-subtle">
        Names are never deleted, only taken off the list — every call, photo and room
        already attributed to someone has to stay answerable after the event.
      </p>
    </div>
  )
}

export default StaffClient
