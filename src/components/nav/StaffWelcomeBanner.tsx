'use client'

import Link from 'next/link'

import { DEPARTMENT_LABELS, departmentHomePath, type StaffDepartment } from '@/lib/departments'

/**
 * Shown when a team member has not picked their name, or to orient them to
 * their department's home screen. One sentence + one big button (R1, R3).
 */
export function StaffWelcomeBanner({
  eventCode,
  department,
  staffMemberId,
}: {
  eventCode: string
  department: StaffDepartment | null
  staffMemberId: string | null
}) {
  if (!staffMemberId) {
    return (
      <div className="mb-4 rounded-2xl border border-brand/30 bg-brand-tint px-4 py-3">
        <p className="text-sm font-medium text-ink">Tap your name so your work is recorded.</p>
        <Link
          href="/pick-staff"
          className="tap mt-2 flex min-h-12 items-center justify-center rounded-xl bg-brand text-base font-semibold text-white"
        >
          Choose your name
        </Link>
      </div>
    )
  }

  if (!department || department === 'management') return null

  const home = departmentHomePath(eventCode, department)
  const label = DEPARTMENT_LABELS[department]

  return (
    <div className="mb-4 rounded-2xl border border-rule bg-surface px-4 py-3">
      <p className="text-sm text-muted">
        You are on the <span className="font-medium text-ink">{label}</span> team.
      </p>
      <Link
        href={home}
        className="tap mt-2 flex min-h-12 items-center justify-center rounded-xl border border-brand/40 bg-brand-tint text-base font-semibold text-brand"
      >
        Open {label.toLowerCase()} work
      </Link>
    </div>
  )
}
