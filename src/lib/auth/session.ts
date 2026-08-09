'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { safeRedirectPath } from '@/lib/utils'
import { CODE_AUTH_COOKIE, STAFF_MEMBER_COOKIE } from '@/lib/auth/cookies'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days — staff log in once per event.

/**
 * Store a verified code-auth token in the session cookie. Called by the
 * client after verify-access-code returns a token. The token is verified
 * on every read (getSessionClaims) — this action just persists it.
 */
export async function setCodeAuthSession(token: string, next: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(CODE_AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })

  revalidatePath('/', 'layout')
  redirect(safeRedirectPath(next))
}

/**
 * Restore a previously-persisted code-auth session without navigating.
 *
 * Same cookie writes as setCodeAuthSession, but NO redirect: this runs from
 * the client SessionBridge when the WebView remounts (tel: dial, camera,
 * memory reclaim) and the httpOnly cookie was lost. The client calls it,
 * then router.refresh()s so the guards re-run with the cookie present.
 *
 * The token is verified on every read (getSessionClaims) exactly as before —
 * this action only persists. A stale or forged token is rejected the moment
 * it is used.
 */
export async function restoreCodeAuthSession(
  token: string,
  staffMemberId: string | null,
): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(CODE_AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })

  if (staffMemberId) {
    cookieStore.set(STAFF_MEMBER_COOKIE, staffMemberId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    })
  }

  revalidatePath('/', 'layout')
}

/**
 * Persist the selected staff member id for the code-auth session. Called
 * by the "Who are you?" picker. The selection is stored beside the JWT
 * (not in it — the JWT is already minted) and merged into the claims on
 * every read.
 */
export async function setStaffMember(staffMemberId: string, eventCode: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(STAFF_MEMBER_COOKIE, staffMemberId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })

  revalidatePath('/', 'layout')
  redirect(`/${eventCode}`)
}

/**
 * Replace the code-auth JWT in the cookie with a re-minted one that carries
 * the staff_member_id claim.
 *
 * `has_staff_identity()` reads `staff_member_id` from `auth.jwt()` — the
 * request's Authorization header — NOT from a cookie. So binding a staff
 * identity requires a NEW JWT (signed by the bind-staff-member Edge Function)
 * that carries the claim, and this action swaps it into the httpOnly cookie.
 * No redirect: the StaffPicker persists the new token to the durable store
 * and navigates itself.
 */
export async function setCodeAuthStaffToken(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(CODE_AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })

  revalidatePath('/', 'layout')
}

/** Clear the code-auth session cookie (sign out). */
export async function clearCodeAuthSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(CODE_AUTH_COOKIE)
  cookieStore.delete(STAFF_MEMBER_COOKIE)
  revalidatePath('/', 'layout')
  redirect('/login')
}
