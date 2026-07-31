/**
 * The one definition of what an event code may contain.
 *
 * Pure and dependency-free on purpose: the create form imports it to show a
 * live preview of what will actually be stored, and the server action imports
 * it to do the real thing. Two copies of this regex would drift, and the
 * moment they drifted the preview would start lying about the URL the human
 * is about to get.
 *
 * It lives beside the only screen that uses it rather than in `src/lib/`.
 * When a second consumer appears — the Excel exporter is the likely one, since
 * the code is stamped into every export — move it to `src/lib/` and delete
 * this file.
 */

/**
 * Codes are typed on a phone and then read back off a URL and out of an Excel
 * header. 24 characters is already far longer than anything anybody wants to
 * thumb in; the database itself imposes no limit (`events.code` is `text`), so
 * this is a product rule, not a schema one.
 */
export const MAX_EVENT_CODE_LENGTH = 24

/**
 * Uppercase, then drop everything that is not A–Z or 0–9.
 *
 * Spaces, hyphens and the em-dash a phone keyboard likes to autocorrect into
 * a name all vanish, so `sharma-patel 26` becomes `SHARMAPATEL26`. The form
 * says so in its hint text and shows the result before submit — a silent
 * transformation on a value that ends up in the address bar would be a nasty
 * surprise.
 */
export function normaliseEventCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
