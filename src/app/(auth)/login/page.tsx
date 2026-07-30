import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { LoginForm } from '@/components/auth/LoginForm'
import { Card, CardBody } from '@/components/ui/Card'
import { getViewer } from '@/lib/supabase/queries'
import { safeRedirectPath } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Sign in',
}

/** Messages for the `?error=` values that /auth/callback can bounce back. */
const CALLBACK_ERRORS: Record<string, string> = {
  link: 'That sign-in link has expired or was already used. Sign in with your password below.',
  session: 'Your session ended. Sign in again to carry on.',
}

export default async function LoginPage({
  searchParams,
}: {
  // Next 15+ hands these over as a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next
  const next = safeRedirectPath(rawNext)

  const rawError = Array.isArray(params.error) ? params.error[0] : params.error
  const notice = rawError ? CALLBACK_ERRORS[rawError] : undefined

  // Already signed in? Don't make them type it again.
  const viewer = await getViewer()
  if (viewer) redirect(next)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-fg">EventFlow</h1>
        <p className="text-base text-muted">Sign in to your event.</p>
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
          <LoginForm next={next} />
        </CardBody>
      </Card>

      <p className="text-center text-sm leading-relaxed text-muted">
        Accounts are created by an event admin. If you cannot get in, ask them to add
        you — there is no self sign-up.
      </p>
    </div>
  )
}
