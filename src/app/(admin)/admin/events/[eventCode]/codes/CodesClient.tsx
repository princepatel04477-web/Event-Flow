'use client'

import { useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { issueAccessCode, type IssuedCode } from '@/lib/actions/access-codes'

export type CodeRow = {
  id: string
  role: 'team' | 'client'
  prefix: string
  lastFour: string
  createdAt: string
  state: 'live' | 'retired' | 'revoked'
}

const ROLE_LABEL: Record<'team' | 'client', string> = {
  team: 'Event team',
  client: 'Client',
}

const ROLE_NOTE: Record<'team' | 'client', string> = {
  team: 'Staff who call families, allocate rooms and log deliveries.',
  client: 'Read-only. The family sees guest details and nothing else.',
}

/**
 * Issue and reveal access codes.
 *
 * THE ONE-SHOT NATURE IS THE WHOLE DESIGN. Only the sha256 is stored, so the
 * plaintext exists for exactly as long as this component holds it in memory.
 * A refresh loses it permanently and the only remedy is to issue another,
 * which invalidates the one just handed out. Everything below — the warning,
 * the size of the type, copy, WhatsApp — exists to make sure that single
 * moment is enough.
 */
export function CodesClient({
  eventId,
  eventCode,
  eventName,
  rows,
  loadError,
}: {
  eventId: string
  eventCode: string
  eventName: string
  rows: CodeRow[]
  loadError: string | null
}) {
  const [issued, setIssued] = useState<IssuedCode | null>(null)
  const [pending, setPending] = useState<'team' | 'client' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleIssue(role: 'team' | 'client') {
    const live = rows.find((r) => r.role === role && r.state === 'live')
    const warning = live
      ? `Replace the current ${ROLE_LABEL[role].toLowerCase()} code (${live.prefix}-…${live.lastFour})?\n\n` +
        'Everyone using it is signed out immediately, and the old code stops working. ' +
        'The new code is shown ONCE.'
      : `Issue the first ${ROLE_LABEL[role].toLowerCase()} code for ${eventName}?\n\nIt is shown ONCE.`

    if (!window.confirm(warning)) return

    setPending(role)
    setError(null)
    setCopied(false)

    const res = await issueAccessCode(eventId, role)
    setPending(null)

    if (!res.ok) {
      setError(res.error)
      return
    }
    setIssued(res.issued)
  }

  async function handleCopy() {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.code)
      setCopied(true)
    } catch {
      // Clipboard can be refused (insecure context, permissions). Say so
      // rather than showing a false "Copied" — the code is unrecoverable and
      // a wrong success message here loses it.
      setError('Could not copy automatically. Select the code above and copy it by hand.')
    }
  }

  const whatsappText = issued
    ? `Nuvent — ${eventName}\n\nYour access code: ${issued.code}\n\nOpen the app and enter it on the sign-in screen. Do not share this code.`
    : ''

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/admin/events/${eventCode}`} className="text-sm text-muted underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-fg">Access codes</h1>
        <p className="mt-1 text-sm text-muted">
          Codes are stored hashed, so an existing code can never be looked up — only
          replaced. Issuing a new one signs out everyone using the old one.
        </p>
      </div>

      {loadError ? (
        <Card className="border-ledger-red/40">
          <CardBody className="py-3">
            <p className="text-sm font-medium text-ledger-red">
              Could not read this event&apos;s codes: {loadError}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-ledger-red/40">
          <CardBody className="py-3">
            <p className="text-sm font-medium text-ledger-red">{error}</p>
          </CardBody>
        </Card>
      ) : null}

      {/* ---- THE REVEAL. Shown once, never retrievable. ---- */}
      {issued ? (
        <Card className="border-2 border-ink bg-surface-2">
          <CardBody className="flex flex-col gap-3 py-4">
            <p className="text-sm font-bold text-fg">
              This code is shown once. Write it down or copy it now.
            </p>
            <p className="text-sm text-muted">
              {ROLE_LABEL[issued.role]} code for {eventName}. It is stored hashed — leaving
              this page loses it for good, and the only fix is to issue another.
            </p>

            <p
              className="select-all rounded-xl border border-border-strong bg-surface px-3 py-4 text-center font-mono text-3xl font-bold tracking-[0.15em] text-fg"
              aria-label={`Access code ${issued.code.split('').join(' ')}`}
            >
              {issued.code}
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" onClick={handleCopy} fullWidth>
                {copied ? 'Copied' : 'Copy code'}
              </Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="tap inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-semibold text-fg"
              >
                Share on WhatsApp
              </a>
            </div>

            {issued.rotated ? (
              <p className="text-xs text-subtle">
                The previous {ROLE_LABEL[issued.role].toLowerCase()} code is now retired.
                Anyone still signed in with it is signed out on their next action.
              </p>
            ) : null}

            <Button type="button" variant="ghost" onClick={() => setIssued(null)} fullWidth>
              I have saved it — hide the code
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {/* ---- Per-role state + issue ---- */}
      {(['team', 'client'] as const).map((role) => {
        const live = rows.find((r) => r.role === role && r.state === 'live')
        const retiredCount = rows.filter((r) => r.role === role && r.state !== 'live').length

        return (
          <Card key={role}>
            <CardBody className="flex flex-col gap-3">
              <div>
                <h2 className="font-semibold text-fg">{ROLE_LABEL[role]}</h2>
                <p className="mt-0.5 text-sm text-muted">{ROLE_NOTE[role]}</p>
              </div>

              <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
                {live ? (
                  <p className="font-mono text-sm text-fg">
                    {live.prefix}-••••{live.lastFour}{' '}
                    <span className="font-sans text-xs text-subtle">
                      · live · issued {new Date(live.createdAt).toLocaleDateString()}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm font-medium text-warning">
                    No live code — nobody can sign in with this role.
                  </p>
                )}
                {retiredCount > 0 ? (
                  <p className="mt-1 text-xs text-subtle">
                    {retiredCount} retired or revoked code
                    {retiredCount === 1 ? '' : 's'} kept, so sessions from them stay
                    recognised and refused.
                  </p>
                ) : null}
              </div>

              <Button
                type="button"
                onClick={() => handleIssue(role)}
                loading={pending === role}
                disabled={pending !== null}
                fullWidth
              >
                {live ? 'Generate new code' : 'Issue first code'}
              </Button>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}

export default CodesClient
