import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { CodeLoginForm } from '@/components/auth/CodeLoginForm'
import { getSessionClaims } from '@/lib/auth/server'
import { safeRedirectPath } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Sign in',
}

/** Messages for the `?error=` values that /auth/callback can bounce back. */
const CALLBACK_ERRORS: Record<string, string> = {
  link: 'That sign-in link has expired or was already used.',
  session: 'Your session ended. Sign in again to carry on.',
}

/**
 * Sign in: mark, one field, one button (SPEC-V3 §4, "centred, one field, one
 * primary").
 *
 * WHAT LEFT THIS SCREEN. The card that wrapped the form (a card around a card
 * is chrome, not grouping), the "Sign in with your access code." subtitle
 * (the field's own label already says it), and the two-line paragraph that
 * explained who uses codes and which sign-in is which. In its place is one
 * quiet line — "Admin sign in" — because that link is the only thing on this
 * screen a staff member ever needs to leave by, and it is not the primary
 * action.
 *
 * NOTHING FUNCTIONAL MOVED. `next` is still sanitised by `safeRedirectPath`,
 * the signed-in redirect is unchanged, the callback notice still renders, and
 * `CodeLoginForm` still calls `persistClaims` / `setCodeAuthSession` with the
 * same arguments in the same order.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next
  const next = safeRedirectPath(rawNext)

  const rawError = Array.isArray(params.error) ? params.error[0] : params.error
  const notice = rawError ? CALLBACK_ERRORS[rawError] : undefined

  // Already signed in via a code? Go where they were headed.
  const claims = await getSessionClaims()
  if (claims) redirect(next)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        {/*
          Decorative: the <h1> immediately below already says EventFlow, so alt
          text here would make a screen reader announce the name twice on the
          way into the form. `unoptimized` — a 64px PNG is not worth a round
          trip to the image optimiser on venue Wi-Fi.
        */}
        <Image
          src="/brand/eventflow-mark.png"
          alt=""
          width={64}
          height={64}
          priority
          unoptimized
        />
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-ink">
          EventFlow
        </h1>
      </div>

      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-ledger-amber bg-amber-tint px-4 py-3 text-sm leading-snug font-medium text-ledger-amber-strong"
        >
          {notice}
        </p>
      ) : null}

      <CodeLoginForm next={next} />

      <Link
        href="/admin/login"
        className="tap inline-flex min-h-11 items-center self-center px-3 text-sm font-medium text-muted underline underline-offset-4 hover:text-ink"
      >
        Admin sign in
      </Link>
    </div>
  )
}
