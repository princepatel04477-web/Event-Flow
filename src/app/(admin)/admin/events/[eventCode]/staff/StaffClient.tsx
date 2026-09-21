'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { UserIcon } from '@/components/icons'
import {
  DEPARTMENT_LABELS,
  STAFF_DEPARTMENTS,
  type StaffDepartment,
} from '@/lib/departments'
import {
  createStaffMember,
  setStaffMemberActive,
  setStaffMemberDepartment,
} from '@/lib/actions/staff'

export type StaffRow = {
  id: string
  fullName: string
  isActive: boolean
  department: StaffDepartment
}

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
  const [department, setDepartment] = useState<StaffDepartment>('management')
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
      const res = await createStaffMember(eventId, eventCode, trimmed, department)
      if (!res.ok) {
        setError(res.error)
        return
      }
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

  function handleDepartmentChange(row: StaffRow, next: StaffDepartment) {
    if (pending || row.department === next) return
    setError(null)
    setBusyId(row.id)
    startTransition(async () => {
      const res = await setStaffMemberDepartment(row.id, eventCode, next)
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
          Who works on {eventName}. Each person picks their name after the team code.
          Their department controls which screens they see — logistics sees Travel,
          hospitality sees Hotel, management sees everything including RSVP calling.
        </p>
      </div>

      {activeCount === 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-rule bg-tint-warning px-4 py-3 text-sm font-medium text-warning"
        >
          Nobody is on this list yet. Add names before the team arrives on site.
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
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Department</span>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value as StaffDepartment)}
                className="min-h-12 rounded-xl border border-rule bg-surface px-3 text-base text-ink"
              >
                {STAFF_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>
                ))}
              </select>
            </label>
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
                <CardBody className="flex flex-col gap-3 py-3">
                  <div className="flex items-center gap-3">
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
                  </div>
                  {row.isActive ? (
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted">Department</span>
                      <select
                        value={row.department}
                        onChange={(e) => handleDepartmentChange(row, e.target.value as StaffDepartment)}
                        disabled={pending}
                        className="min-h-11 rounded-lg border border-rule bg-surface px-3 text-sm text-ink"
                      >
                        {STAFF_DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
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
