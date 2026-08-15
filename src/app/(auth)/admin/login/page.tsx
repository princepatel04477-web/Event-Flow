import type { Metadata } from 'next'
import Link from 'next/link'

import { LoginForm } from '@/components/auth/LoginForm'
import { Card, CardBody } from '@/components/ui/Card'

export const metadata: Metadata = {
  title: 'Admin sign in',
}

/**
 * Admin login — the ONLY place email/password exists. Admins are created
 * directly in Supabase (no signup, no invite). Team and client use access
 * codes on /login.
 */
export default function AdminLoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="font-display text-3xl tracking-tight text-fg">EventFlow admin</h1>
        <p className="text-base text-muted">Sign in with your admin account.</p>
      </div>

      <Card>
        <CardBody className="px-5 py-6">
          <LoginForm next="/admin/events" />
        </CardBody>
      </Card>

      <p className="text-center text-sm leading-relaxed text-muted">
        <Link href="/login" className="font-medium text-brand">Team or client? Use an access code</Link>
      </p>
    </div>
  )
}
