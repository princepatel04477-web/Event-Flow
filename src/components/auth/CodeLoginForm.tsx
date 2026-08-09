'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { setCodeAuthSession } from '@/lib/auth/session'
import { getDeviceId } from '@/lib/device'
import { persistClaims } from '@/lib/native/session-keeper'

/**
 * Code login — the ONLY login for team and client. One large code input,
 * no email or password anywhere on this route.
 *
 * Flow:
 *   1. User types an access code (E-XXXXXX / C-XXXXXX).
 *   2. We POST it to the verify-access-code Edge Function with a stable
 *      device id (used for rate limiting).
 *   3. On success, the server action persists the minted JWT in the
 *      httpOnly session cookie.
 *   4. A team role goes to the staff picker; a client role goes straight
 *      to the guest list.
 *
 * The Edge Function never reveals whether the prefix was valid or which
 * part was wrong — a failure always reads "Invalid code".
 */
export function CodeLoginForm({ next }: { next: string }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    if (!code.trim()) {
      setError('Enter your access code.')
      return
    }

    setPending(true)
    setError(null)

    try {
      const deviceId = await getDeviceId()
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/verify-access-code`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code.trim(), device_id: deviceId }),
        },
      )

      const body = await res.json().catch(() => null)

      if (res.status !== 200 || !body?.access_token) {
        setError(body?.error === 'Too many attempts. Try again later.' ? body.error : 'Invalid code')
        setPending(false)
        return
      }

      // Persist the session, then route by role. The token is written to
      // durable storage (Capacitor Preferences on native) so a later WebView
      // remount — a tel: dial, a camera capture, Android reclaiming memory —
      // can rehydrate the httpOnly cookie and not bounce to /login.
      // Persisted BEFORE the redirecting server action: setCodeAuthSession
      // ends in redirect(), and anything after it on the client is not
      // guaranteed to run.
      const target = body.app_role === 'team' ? '/pick-staff' : '/'
      await persistClaims({ token: body.access_token, staffMemberId: null, eventCode: null })
      await setCodeAuthSession(body.access_token, target)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red bg-red-tint px-4 py-3 text-sm leading-snug font-medium text-ledger-red"
        >
          {error}
        </p>
      ) : null}

      <label htmlFor="access-code" className="text-sm font-medium text-fg">
        Access code
      </label>
      <input
        id="access-code"
        name="access-code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase())
          setError(null)
        }}
        placeholder="E-XXXXXX or C-XXXXXX"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        enterKeyHint="go"
        aria-label="Access code"
        className="min-h-14 w-full rounded-xl border border-border-strong bg-surface px-4 text-center font-mono text-xl tracking-[0.2em] text-fg placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-ink"
        required
      />
      <p className="text-xs leading-relaxed text-subtle">
        The hyphen is optional. Codes are case-insensitive. Ask your event admin if you do
        not have one.
      </p>

      <Button type="submit" size="lg" fullWidth loading={pending} className="mt-2">
        {pending ? 'Checking…' : 'Enter event'}
      </Button>
    </form>
  )
}

export default CodeLoginForm
