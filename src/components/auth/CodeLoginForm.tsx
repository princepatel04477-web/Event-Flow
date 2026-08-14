'use client'

import { useEffect, useRef, useState } from 'react'

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
/**
 * How long to wait for verify-access-code before giving up.
 *
 * Generous — venue Wi-Fi is slow, and a staff member would rather wait than
 * be told to retry a request that was about to succeed. But bounded: an
 * unbounded spinner is indistinguishable from a frozen app.
 */
const LOGIN_TIMEOUT_MS = 20_000

export function CodeLoginForm({ next }: { next: string }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Has React taken over the form yet?
  //
  // Before hydration, a tap on the submit button is handled by the BROWSER,
  // not by handleSubmit — so `e.preventDefault()` never runs and the form does
  // a default GET. Observed on 2026-08-10: the page reloaded to
  // `/login?access-code=E-8DRCJR`, no request ever reached verify-access-code,
  // and the access code was written into the URL — i.e. into browser history,
  // the server access log, and any Referer header. On a cheap handset on venue
  // Wi-Fi, hydration is slow and an impatient staff member reproduces this
  // easily. The button stays disabled until this flips.
  const [hydrated, setHydrated] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // ADOPT whatever the browser already has in the field.
    //
    // Anything typed before hydration went into the DOM but never reached
    // React state — onChange was not attached yet. This is a controlled
    // input, so the first render after hydration would otherwise write
    // `value={code}` (empty) straight over the user's typing and silently
    // erase it. On a cheap handset that is exactly what happens: staff type
    // their code into a page that has not finished booting and watch it
    // vanish. Confirmed 2026-08-10 — the submit then failed with "Enter your
    // access code." against a field that visibly had one.
    const typed = inputRef.current?.value ?? ''
    if (typed) setCode(typed.toUpperCase())
    setHydrated(true)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    if (!code.trim()) {
      setError('Enter your access code.')
      return
    }

    setPending(true)
    setError(null)

    // Bound the wait. Without a timeout this fetch can hang indefinitely on
    // venue Wi-Fi — observed 2026-08-10: the POST was sent and no response
    // ever arrived, past 18 seconds, with no error event. The staff member
    // sees a spinner forever, with nothing to tap and no idea whether it is
    // working. A bounded failure they can retry beats an unbounded wait.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS)

    try {
      const deviceId = await getDeviceId()
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/verify-access-code`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code.trim(), device_id: deviceId }),
          signal: controller.signal,
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
      // Team sessions used to be routed to /pick-staff, because every write
      // policy required a staff_member_id claim and one had to be bound before
      // anything could be saved. Migration 20260814140000 removed that gate,
      // so the picker no longer unblocks anything — it would just be a screen
      // asking a question whose answer is no longer used.
      //
      // /pick-staff and the admin staff screen both still exist. Naming
      // yourself is now optional: do it and writes carry your name, skip it
      // and they carry nobody.
      //
      // `next` was being ignored entirely — both branches of the old ternary
      // discarded it — so anyone arriving from a deep link (the proxy sends
      // /login?next=<path> for any guarded URL) was dropped at the root after
      // signing in, and had to find their way back by hand. Only same-origin
      // paths are honoured: a value starting `//` is a protocol-relative URL
      // pointing at another host, which is an open redirect, not a route.
      const target = next?.startsWith('/') && !next.startsWith('//') ? next : '/'
      await persistClaims({ token: body.access_token, staffMemberId: null, eventCode: null })
      await setCodeAuthSession(body.access_token, target)
    } catch (err) {
      // Distinguish "we gave up waiting" from "the network refused us".
      // setCodeAuthSession ends in redirect(), which Next signals by
      // throwing — that must pass through, not be reported as a failure.
      if (err && typeof err === 'object' && 'digest' in err) throw err

      const timedOut = err instanceof DOMException && err.name === 'AbortError'
      setError(
        timedOut
          ? `The server did not answer within ${Math.round(LOGIN_TIMEOUT_MS / 1000)} seconds. Check your signal and tap Enter event again.`
          : 'Could not reach the server. Check your connection and try again.',
      )
      setPending(false)
    } finally {
      clearTimeout(timer)
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
        ref={inputRef}
        // Deliberately UNNAMED. A nameless field is omitted from a native form
        // submission, so even if one somehow fires the access code cannot end
        // up in the URL. Belt and braces alongside the `hydrated` gate above.
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

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={pending || !hydrated}
        disabled={!hydrated}
        className="mt-2"
      >
        {pending ? 'Checking…' : 'Enter event'}
      </Button>
    </form>
  )
}

export default CodeLoginForm
