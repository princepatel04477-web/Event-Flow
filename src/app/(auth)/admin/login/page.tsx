import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { LoginForm } from '@/components/auth/LoginForm'

export const metadata: Metadata = {
  title: 'Admin sign in',
}

/**
 * Admin login — the ONLY place email/password exists. Admins are created
 * directly in Supabase (no signup, no invite). Team and client use access
 * codes on /login.
 *
 * The same shape as the team sign-in (SPEC-V3 §4): mark, one title, one
 * primary button, one quiet way back. The card wrapper and the "Sign in with
 * your admin account." subtitle are gone; the fields carry their own labels
 * and the form's own button is the single commit on the screen.
 */
export default function AdminLoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Image
          src="/brand/eventflow-mark.png"
          alt=""
          width={64}
          height={64}
          priority
          unoptimized
        />
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-ink">
          EventFlow admin
        </h1>
      </div>

      <LoginForm next="/admin/events" />

      <Link
        href="/login"
        className="tap inline-flex min-h-11 items-center self-center px-3 text-center text-sm font-medium text-muted underline underline-offset-4 hover:text-ink"
      >
        Team or client? Use an access code
      </Link>
    </div>
  )
}
