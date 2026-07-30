'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { safeRedirectPath } from '@/lib/utils'

/**
 * Shape returned to the login form by `useActionState`.
 *
 * Types are the only non-function export allowed here — a 'use server' module
 * may not export values, so the form supplies its own initial state.
 */
export type SignInState = {
  error: string | null
}

/**
 * Email + password sign-in.
 *
 * Runs as the anon key against Supabase Auth; from that point every request
 * carries the user's own session cookie, so RLS and the audit triggers see a
 * real person rather than a shared service identity.
 *
 * Never surfaces a raw Postgres or GoTrue message — staff read these on a
 * phone in a corridor, and the underlying text leaks whether an account
 * exists.
 */
export async function signIn(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = safeRedirectPath(formData.get('next'))

  if (!email || !password) {
    return { error: 'Enter your email and password.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: friendlyAuthError(error) }
  }

  // The whole tree is user-scoped, so drop the cached render of every layout.
  revalidatePath('/', 'layout')
  redirect(next)
}

/**
 * Sign out and return to /login.
 *
 * Safe to use directly as a `<form action={signOut}>` target.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()

  revalidatePath('/', 'layout')
  redirect('/login')
}

type MaybeAuthError = {
  message?: string
  code?: string
  status?: number
}

/** Map GoTrue failures onto sentences a wedding coordinator can act on. */
function friendlyAuthError(error: MaybeAuthError): string {
  const code = error.code ?? ''
  const message = (error.message ?? '').toLowerCase()

  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'Wrong email or password.'
  }

  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'That email has not been confirmed yet. Ask an admin to re-send your invite.'
  }

  if (code === 'user_banned' || message.includes('banned')) {
    return 'This account has been disabled. Ask an admin to re-enable it.'
  }

  if (
    error.status === 429 ||
    code === 'over_request_rate_limit' ||
    message.includes('rate limit')
  ) {
    return 'Too many attempts. Wait a minute, then try again.'
  }

  if (code === 'validation_failed' || message.includes('unable to validate email')) {
    return 'That does not look like a valid email address.'
  }

  if (
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('timeout')
  ) {
    return 'Could not reach the server. Check your connection and try again.'
  }

  return 'Could not sign you in just now. Try again in a moment.'
}
