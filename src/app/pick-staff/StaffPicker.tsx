'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Row } from '@/components/ui/Row'
import { Spinner } from '@/components/ui/Spinner'
import { setCodeAuthStaffToken } from '@/lib/auth/session'
import { persistClaims, readStoredClaims } from '@/lib/native/session-keeper'
import { initials } from '@/lib/ui/metrics'

import {
  DEPARTMENT_LABELS,
  postLoginHome,
  type StaffDepartment,
} from '@/lib/departments'
import { getUiVersion } from '@/lib/ui-version'

interface StaffMember {
  id: string
  full_name: string
  department?: StaffDepartment | null
}

/**
 * One tap, no password: pick who you are from the event's staff list.
 *
 * Writes are gated on `app.has_staff_identity(event_id)`, which reads the
 * `staff_member_id` CLAIM from the JWT — not a cookie, not the client. So
 * picking a name RE-MINTS the session: the bind-staff-member Edge Function
 * verifies the existing code JWT, checks the staff member belongs to this
 * event and is active, and returns a new JWT carrying `staff_member_id`.
 * The new token replaces the durable session AND the httpOnly cookie, then
 * routes into the event. No selection = no writes (enforced in RLS).
 *
 * The landing path is the shell's, not this component's: `postLoginHome`
 * refuses to guess which UI is rendering and asks `getUiVersion()`. Under v2
 * an event lead lands on the dashboard; under v1 they keep landing on
 * Auto-call. Hardcoding either one here is how this hop was left behind.
 *
 * ── v3 (SPEC-V3 §4): "staff picker = big Rows of names" ───────────────────
 * The list was a column of bordered buttons with a user glyph, a name and a
 * second line of department text — three visual objects per person, on the
 * one screen whose entire job is "find your own name and hit it". It is now
 * the shared `Row`: a 64px tap target, the name as the heading, the
 * department as the single muted meta line, and initials in the avatar slot
 * so a reader with a common name can tell two rows apart at a glance.
 * `onPress`, the disabled-while-pending gate and the spinner are unchanged;
 * so are `persistClaims`, `setCodeAuthStaffToken` and the `postLoginHome`
 * redirect, which are the parts that must not drift.
 */
export function StaffPicker({ members, eventCode }: { members: StaffMember[]; eventCode: string }) {
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function pick(id: string) {
    if (pending) return
    const member = members.find((m) => m.id === id)
    setPending(id)
    setError(null)
    try {
      const stored = await readStoredClaims()
      if (!stored?.token) {
        setError('Your session has expired. Sign in again.')
        setPending(null)
        return
      }

      // 1. Re-mint the JWT with the staff_member_id claim.
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/bind-staff-member`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: stored.token, staff_member_id: id }),
        },
      )
      const body = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null

      if (res.status !== 200 || !body?.access_token) {
        setError(body?.error ?? 'Could not save your selection. Try again.')
        setPending(null)
        return
      }

      // 2. Persist the new token + staff identity (durable, survives remount).
      await persistClaims({
        token: body.access_token,
        staffMemberId: id,
        eventCode,
      })

      // 3. Swap the httpOnly cookie to the re-minted token (no redirect).
      await setCodeAuthStaffToken(body.access_token)

      // 4. Enter the event. A full navigation (not client router.push) so the
      // fresh httpOnly cookie is sent on the request.
      //
      // The destination is resolved by UI version, not by
      // `departmentHomePath` alone: v2's department home and v1's disagree for
      // `management` and `hamper` (see `postLoginHome`). Using the shared v1
      // answer here sent every event lead straight to Auto-call on the hop
      // immediately after login — the one landing `v2DepartmentHome` cannot
      // cover, because it only runs once a page is already rendering.
      const dept = member?.department ?? 'management'
      router.replace(postLoginHome(getUiVersion(), eventCode, dept))
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-ink">
          Tap your name
        </h1>
        <p className="text-sm text-muted">One tap. No password.</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-ledger-red bg-red-tint px-4 py-3 text-sm font-medium text-ledger-red">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-rule bg-surface">
        {members.map((m) => (
          <Row
            key={m.id}
            heading={m.full_name}
            meta={m.department ? DEPARTMENT_LABELS[m.department] : undefined}
            initials={initials(m.full_name)}
            onPress={() => pick(m.id)}
            disabled={pending !== null}
            trailing={
              pending === m.id ? <Spinner size="sm" label="Saving your name" /> : undefined
            }
          />
        ))}
      </div>

      {/* Skip exists because the RLS write gate is gone (migration
          20260814140000): a name is no longer required to use the app, only to
          record who did what. Without this control the screen would be a hard
          stop for anyone whose name is not on the list yet — on a wedding
          morning, with a staff member standing in front of a family, that is
          the worst possible time to be blocked by an admin task.

          It stays an `<a>` to `/{eventCode}` with the text "Skip for now":
          `scripts/tabs-reach.mjs` reads the event code off exactly this link,
          and it is the only route onward for a runner whose name is missing. */}
      <Link
        href={`/${eventCode}`}
        className="tap flex min-h-13 w-full items-center justify-center rounded-xl border-[1.5px] border-rule-strong bg-surface text-base font-semibold text-ink active:bg-surface-2"
      >
        Skip for now
      </Link>

      {/* One line, not the three-line paragraph that used to sit here. The
          consequence of skipping still has to be said — nothing else in the
          app will tell them their work is unattributed. */}
      <p className="text-sm leading-snug text-muted">
        Skipping is fine — your work just will not carry your name.
      </p>
    </div>
  )
}

export default StaffPicker
