/**
 * Access-code generation — shared by the event-create action (server)
 * and any admin reveal flow.
 *
 * Alphabet: ABCDEFGHJKMNPQRSTUVWXYZ23456789 (no 0/O/1/I/L — misread
 * over a phone). Case-insensitive on entry, displayed uppercase.
 */
export const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ACCESS_CODE_LENGTH = 6

/** Generate one random code body of `ACCESS_CODE_LENGTH` chars. */
export function randomCodeBody(): string {
  let out = ''
  for (let i = 0; i < ACCESS_CODE_LENGTH; i++) {
    // crypto.getRandomValues gives uniform bytes; use rejection-free
    // modulo by keeping the byte < largest multiple of the alphabet.
    const bytes = new Uint8Array(1)
    crypto.getRandomValues(bytes)
    out += ACCESS_CODE_ALPHABET[bytes[0] % ACCESS_CODE_ALPHABET.length]
  }
  return out
}

/** Full code with prefix: 'E-XXXXXX' (team) or 'C-XXXXXX' (client). */
export function generateAccessCode(role: 'team' | 'client'): string {
  const prefix = role === 'team' ? 'E' : 'C'
  return `${prefix}-${randomCodeBody()}`
}
