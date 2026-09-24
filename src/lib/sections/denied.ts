/**
 * The sentences a `?denied=` bounce carries, in the app's own voice.
 *
 * WHY THIS IS ONE MODULE AND NOT A CONSTANT IN THE DASHBOARD. The note used to
 * be rendered ONLY by Today (`(app)/v2/[eventCode]/page.tsx`), and
 * `requireSection` bounces a denied viewer to their OWN department home instead
 * — Rooms for a hospitality runner, Arrivals for a travel runner, Hampers for a
 * hamper runner. None of those reads the marker, so a refused tap looked like a
 * link that did nothing: the most confusing possible outcome, on a runner's only
 * navigation (`docs/BUGS.md` M3, M7). The shell now renders this note on every
 * screen, and the shell is a client tree, so the lookup lives in a module with
 * no server imports and a test.
 *
 * A closed union, not free text: the value arrives in a URL query string, and
 * nobody gets to inject a sentence into the app's own voice.
 */
export type DeniedKey = 'import' | 'admin' | 'section'

export const DENIED_MESSAGES: Record<DeniedKey, string> = {
  import:
    'Importing the guest list is an admin job, so we brought you back here. Ask your event admin to run the import.',
  admin: 'That screen is admin-only, so we brought you back here.',
  section:
    'That screen is for another team. Use the tabs at the bottom for your department.',
}

/** The sentence for a `?denied=` value, or null when there is none / unknown. */
export function deniedMessage(value: string | null | undefined): string | null {
  if (!value) return null
  return value in DENIED_MESSAGES ? DENIED_MESSAGES[value as DeniedKey] : null
}
