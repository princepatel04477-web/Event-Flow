'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { UserIcon } from '@/components/icons'
import { setCodeAuthStaffToken } from '@/lib/auth/session'
import { persistClaims, readStoredClaims } from '@/lib/native/session-keeper'
import { cn } from '@/lib/utils'

interface StaffMember {
  id: string
  full_name: string
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
 */
export function StaffPicker({ members, eventCode }: { members: StaffMember[]; eventCode: string }) {
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function pick(id: string) {
    if (pending) return
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
      router.replace(`/${eventCode}`)
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Who are you?</h2>
        <p className="mt-0.5 text-sm text-muted">
          So your deliveries, calls and check-ins are recorded against you. One tap — no
          password.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-ledger-red bg-red-tint px-4 py-3 text-sm font-medium text-ledger-red">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {members.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => pick(m.id)}
              disabled={pending !== null}
              className={cn(
                'flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 text-left active:bg-surface-2 disabled:opacity-60',
              )}
            >
              <UserIcon className="h-5 w-5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate font-semibold text-fg">{m.full_name}</span>
              {pending === m.id ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-rule-strong border-t-brand" aria-hidden />
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-subtle">
        Picked the wrong one? There is a &quot;Not you? Switch&quot; option in settings later.
      </p>
    </div>
  )
}

export default StaffPicker
