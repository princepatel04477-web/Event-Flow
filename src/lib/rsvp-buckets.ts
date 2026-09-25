/**
 * The five confirmation buckets, as a plain module.
 *
 * NOT in `@/lib/actions/dashboard`: that file is `'use server'`, and a
 * `'use server'` module may only export async functions — a `const` array
 * there compiles to a runtime object export and fails the build with "A
 * 'use server' file can only export async functions". The vocabulary is shared
 * by the action (which buckets families) and the tab strip (which names them),
 * so it lives here and both import it.
 */

export type RsvpBucketId = 'confirmed' | 'not_coming' | 'maybe' | 'no_answer' | 'not_called'

/** Tab order is the calling funnel, then the settled answers, then the tail. */
export const RSVP_BUCKETS: readonly { id: RsvpBucketId; label: string }[] = [
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'not_coming', label: 'Not coming' },
  { id: 'maybe', label: 'Maybe' },
  { id: 'no_answer', label: 'No answer' },
  { id: 'not_called', label: 'Not called' },
]
