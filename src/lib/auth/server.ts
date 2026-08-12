// M2: static export — no cookies, no server. Re-export client auth.
// Callers that previously imported getSessionClaims from here should now
// use readSessionClaims from '@/lib/auth/session-client'.

export { readSessionClaims as getSessionClaims } from '@/lib/auth/session-client'
