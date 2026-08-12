/**
 * In-memory mirror of the current code-auth JWT for the browser Supabase
 * client's fetch wrapper.
 *
 * The durable store (Capacitor Preferences) is async; the fetch wrapper needs
 * the token synchronously on every request. session-keeper writes this cache
 * whenever it persists/reads claims; the browser client's fetch wrapper reads
 * it. Own module to avoid a circular import (client.ts <-> session-keeper.ts).
 */
export const codeTokenCache: { current: string | null } = { current: null }
