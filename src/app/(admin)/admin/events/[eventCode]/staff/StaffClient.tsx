'use client'

import { useState, useTransition } from 'react'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Row } from '@/components/ui/Row'
import { initials } from '@/lib/ui/metrics'
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
      <AdminPageTitle
        context={
          activeCount === 0
            ? 'Nobody on the list'
            : `${activeCount} on the list · ${eventName}`
        }
      >
        Staff
      </AdminPageTitle>

      {activeCount === 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-ledger-amber/40 bg-amber-tint px-4 py-3 text-sm font-medium text-ledger-amber"
        >
          Nobody is on this list yet — add names before the team arrives.
        </div>
      ) : null}

      {loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-ledger-red/35 bg-red-tint px-4 py-3 text-sm font-medium text-ledger-red"
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
              <span className="eyebrow">Department</span>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value as StaffDepartment)}
                className="tap min-h-14 rounded-xl border border-rule-strong bg-surface px-4 text-base text-ink"
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
              <Card>
                {/* The toggle is NOT `Row`'s `trailing`: "Put back" next to the
                    status word leaves the name about 70px at 360px, and a list
                    of truncated names is worse than a taller card. The row
                    stays the register's shape; the controls sit under it. */}
                <Row
                  heading={row.fullName}
                  meta={row.isActive ? DEPARTMENT_LABELS[row.department] : 'Not on the pick list'}
                  initials={initials(row.fullName)}
                  status={row.isActive ? 'Active' : 'Off'}
                  tone={row.isActive ? 'done' : 'neutral'}
                />

                <div className="flex items-end gap-3 px-3 pt-3 pb-4">
                  {row.isActive ? (
                    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="eyebrow">Department</span>
                      <select
                        value={row.department}
                        onChange={(e) => handleDepartmentChange(row, e.target.value as StaffDepartment)}
                        disabled={pending}
                        className="tap min-h-12 rounded-xl border border-rule-strong bg-surface px-4 text-base text-ink"
                      >
                        {STAFF_DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="min-w-0 flex-1 text-sm text-muted">
                      Off the pick list — nothing new is recorded against them.
                    </p>
                  )}

                  <Button
                    variant={row.isActive ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => handleToggle(row)}
                    loading={busyId === row.id}
                    disabled={pending && busyId !== row.id}
                    className="shrink-0"
                  >
                    {row.isActive ? 'Remove' : 'Put back'}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default StaffClient
