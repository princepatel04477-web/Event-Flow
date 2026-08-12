import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { CodeLoginForm } from '@/components/auth/CodeLoginForm'
import { Card, CardBody } from '@/components/ui/Card'
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
      <div className="flex flex-col gap-1 text-center">
        <h1 className="font-display text-3xl tracking-tight text-fg">Nuvent</h1>
        <p className="text-base text-muted">Sign in with your access code.</p>
      </div>

      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-border bg-tint-warning px-4 py-3 text-base text-warning"
        >
          {notice}
        </p>
      ) : null}

      <Card>
        <CardBody className="px-5 py-6">
          <CodeLoginForm next={next} />
        </CardBody>
      </Card>

      <p className="text-center text-sm leading-relaxed text-muted">
        Event team and client use access codes. <Link href="/admin/login" className="font-medium text-brand">Admin sign in</Link> is separate.
      </p>
    </div>
  )
}
