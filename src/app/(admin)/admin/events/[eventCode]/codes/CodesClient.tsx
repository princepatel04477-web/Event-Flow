'use client'

import { useState } from 'react'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button, buttonClassName } from '@/components/ui/Button'
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
  team: 'Calls families, allocates rooms, logs deliveries.',
  client: 'Read-only. Guest details and nothing else.',
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
    ? `EventFlow — ${eventName}\n\nYour access code: ${issued.code}\n\nOpen the app and enter it on the sign-in screen. Do not share this code.`
    : ''

  return (
    <div className="flex flex-col gap-5">
      <AdminPageTitle context={eventName}>Access codes</AdminPageTitle>

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
            <p className="text-sm font-bold text-ink">
              Shown once. Write it down or copy it now.
            </p>
            <p className="text-sm text-muted">
              {ROLE_LABEL[issued.role]} code for {eventName} — stored hashed, so leaving
              this page loses it for good.
            </p>

            <p
              className="code-figure select-all rounded-xl border border-rule-strong bg-surface px-3 py-4 text-center text-3xl font-bold text-ink"
              aria-label={`Access code ${issued.code.split('').join(' ')}`}
            >
              {issued.code}
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" onClick={handleCopy} fullWidth>
                {copied ? 'Copied' : 'Copy code'}
              </Button>
              {/* An external target, so this is a plain <a> wearing the
                  shared button classes rather than a LinkButton — `LinkButton`
                  has no `target`/`rel`, and `wa.me` must open in the OS
                  browser, not inside the WebView. */}
              <a
                href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClassName({ variant: 'secondary', fullWidth: true })}
              >
                Share on WhatsApp
              </a>
            </div>

            {issued.rotated ? (
              <p className="text-xs text-subtle">
                The previous {ROLE_LABEL[issued.role].toLowerCase()} code is retired.
                Anyone signed in with it is signed out on their next action.
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
                <h2 className="text-base font-semibold text-ink">{ROLE_LABEL[role]}</h2>
                <p className="mt-0.5 text-sm text-muted">{ROLE_NOTE[role]}</p>
              </div>

              <div className="rounded-xl bg-surface-2 px-3 py-2.5">
                {live ? (
                  <p className="code-figure text-sm text-ink">
                    {live.prefix}-••••{live.lastFour}{' '}
                    <span className="text-xs text-subtle">
                      · live · issued {new Date(live.createdAt).toLocaleDateString()}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm font-medium text-ledger-amber">
                    No live code — nobody can sign in with this role.
                  </p>
                )}
                {retiredCount > 0 ? (
                  <p className="mt-1 text-xs text-subtle">
                    <span className="figure">{retiredCount}</span> retired or revoked kept,
                    so sessions from them stay recognised and refused.
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
