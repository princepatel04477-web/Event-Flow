'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'
import {
  MAX_EVENT_CODE_LENGTH,
  normaliseEventCode,
} from '@/app/(admin)/admin/events/eventCode'

/**
 * Creating an event — the only write on the admin route group.
 *
 * There is no permission check in here on purpose. `events` has
 * `insert with check (app.is_admin())`, so the database is the fence: a
 * non-admin's insert comes back as `42501` and is reported as such. The
 * layout redirect above this is a UX affordance, not the boundary.
 */

/** Postgres unique violation — here it can only be `events.code`. */
const UNIQUE_VIOLATION = '23505'

/** Postgres insufficient_privilege — RLS refused the row. */
const RLS_DENIED = '42501'

/** Per-phase server-side timing for event creation (measure, then trust). */
function phaseTiming(label: string) {
  const marks: Record<string, number> = {}
  let last = performance.now()
  return {
    mark(name: string) {
      const now = performance.now()
      marks[name] = Math.round(now - last)
      last = now
    },
    report() {
      const parts = Object.entries(marks).map(([k, v]) => `${k}:${v}ms`)
      console.log(`[perf] ${label} phases :: ${parts.join(' · ')}`)
    },
  }
}

/**
 * A hand-written shim around `supabase.rpc`.
 *
 * `database.types.ts` is GENERATED and only lists what existed at its last
 * regeneration, so it does not know `create_event_with_defaults` until the
 * migration is applied and the types regenerated. Rather than hand-edit a
 * generated file, this narrows the client to the exact call used.
 */
type UntypedRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: unknown
    error: { code?: string | null; message?: string | null } | null
  }>
}

/** Which field a message belongs under, so it renders next to the input. */
export type CreateEventFieldErrors = {
  name?: string
  code?: string
  startsOn?: string
  endsOn?: string
}

/**
 * Everything the form needs to re-render itself after a refusal.
 *
 * `values` echoes what was submitted so nothing typed on a phone is lost —
 * re-keying six fields one-handed because a code collided is how staff stop
 * using a tool.
 *
 * Types are the only non-function export a 'use server' module may have, so
 * the form owns its own initial state. Same arrangement as
 * `src/lib/actions/auth.ts`.
 */
export type CreateEventState = {
  /** Form-level failure — a refusal from the database, not a bad field. */
  error: string | null
  fieldErrors: CreateEventFieldErrors
  values: {
    name: string
    code: string
    brideName: string
    groomName: string
    startsOn: string
    endsOn: string
  }
  /** Set on success: the event code + the two access codes, shown once. */
  created?: {
    eventCode: string
    teamCode: string
    clientCode: string
  }
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Empty string means "leave it null", not "store an empty string". */
function orNull(value: string): string | null {
  return value === '' ? null : value
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * True for a real calendar date in `YYYY-MM-DD`.
 *
 * `<input type="date">` always submits this shape, but the action is a POST
 * endpoint like any other and cannot assume its caller was the form.
 * Round-tripping through `Date.UTC` rejects 2026-02-30, which a regex alone
 * would wave through.
 */
function isCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/**
 * Create an event and land the admin on it.
 *
 * Runs as the signed-in user through `createClient()` — never a service-role
 * key — so `app.is_admin()` is evaluated against a real account and the audit
 * trigger on `events` records who created it.
 *
 * `starts_on` is nullable in the database but required here. That is not
 * tidiness: the Excel import resolves dates written as "4th" against the
 * event's month, so an event with no start date cannot be imported into. The
 * rule is enforced in the form and stated in its help text, because the human
 * reads the screen, not this comment.
 */
export async function createEvent(
  _prevState: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const rawCode = text(formData.get('code'))

  const values: CreateEventState['values'] = {
    name: text(formData.get('name')),
    // Echo the canonical form back, not what was typed — if anything else on
    // the form fails, the admin sees the code they are actually about to get.
    code: normaliseEventCode(rawCode),
    brideName: text(formData.get('bride_name')),
    groomName: text(formData.get('groom_name')),
    startsOn: text(formData.get('starts_on')),
    endsOn: text(formData.get('ends_on')),
  }

  const fieldErrors: CreateEventFieldErrors = {}

  if (!values.name) {
    fieldErrors.name = 'Give the event a name.'
  }

  if (!rawCode) {
    fieldErrors.code = 'Give the event a short code.'
  } else if (!values.code) {
    fieldErrors.code = 'The code needs at least one letter or number.'
  } else if (values.code.length > MAX_EVENT_CODE_LENGTH) {
    fieldErrors.code = `Keep the code to ${MAX_EVENT_CODE_LENGTH} characters or fewer.`
  }

  if (!values.startsOn) {
    fieldErrors.startsOn = 'Pick the first day of the event.'
  } else if (!isCalendarDate(values.startsOn)) {
    fieldErrors.startsOn = 'That is not a real date.'
  }

  if (values.endsOn && !isCalendarDate(values.endsOn)) {
    fieldErrors.endsOn = 'That is not a real date.'
  } else if (
    values.endsOn &&
    !fieldErrors.startsOn &&
    values.endsOn < values.startsOn
  ) {
    // Both are `YYYY-MM-DD`, so a string compare is a date compare.
    fieldErrors.endsOn = 'The last day cannot be before the first day.'
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      error: 'Your session has expired. Sign in again and retry.',
      fieldErrors: {},
      values,
    }
  }

  // Hash the codes here — the plaintext never reaches the database, and
  // neither the RPC nor `event_access_codes` can store it. These two imports
  // and the two digests are all the work left in the app: the two inserts used
  // to be two sequential round trips to the database and are now one call into
  // `create_event_with_defaults`, one transaction, one hop.
  const timing = phaseTiming('event :: createEvent')
  const { createHash } = await import('node:crypto')
  const { generateAccessCode } = await import('@/lib/auth/codes')
  timing.mark('imports')

  const teamCode = generateAccessCode('team')
  const clientCode = generateAccessCode('client')
  const teamHash = createHash('sha256').update(teamCode.replace('-', '')).digest('hex')
  const clientHash = createHash('sha256').update(clientCode.replace('-', '')).digest('hex')
  timing.mark('codes')

  const { data, error } = await (supabase as unknown as UntypedRpc).rpc(
    'create_event_with_defaults',
    {
      p_name: values.name,
      p_code: values.code,
      p_bride_name: values.brideName,
      p_groom_name: values.groomName,
      p_starts_on: values.startsOn,
      p_ends_on: orNull(values.endsOn),
      p_team_hash: teamHash,
      p_team_last_four: teamCode.slice(-4),
      p_client_hash: clientHash,
      p_client_last_four: clientCode.slice(-4),
    },
  )
  timing.mark('rpc')
  timing.report()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        error: null,
        fieldErrors: { code: 'That code is already taken.' },
        values,
      }
    }

    if (error.code === RLS_DENIED) {
      return {
        error: 'Only an admin can create an event.',
        fieldErrors: {},
        values,
      }
    }

    return { error: friendlyDbError(error), fieldErrors: {}, values }
  }

  // Every layout above reads the viewer's event list — the front door, the
  // event switcher, this page. Drop the lot rather than guess which.
  revalidatePath('/', 'layout')

  // Return the codes to the form so the admin can share them ONCE. They
  // are never persisted in plaintext; this is the single reveal.
  const created = (data ?? {}) as { code?: string }
  return {
    error: null,
    fieldErrors: {},
    values,
    created: {
      eventCode: created.code ?? values.code,
      teamCode,
      clientCode,
    },
  }
}

// ---------------------------------------------------------------------------
// Archive / restore — the soft delete, and the only "remove" this app offers
// ---------------------------------------------------------------------------

/**
 * Archiving an event, and why there is no delete beside it.
 *
 * `delivery_proofs.event_id` is `ON DELETE RESTRICT` and `delivery_proofs`
 * carries an unconditional `block_mutation()` trigger on DELETE. An event
 * that has ever recorded one proof therefore cannot be deleted by anybody —
 * not an admin, not the service role — and the attempt surfaces as a raw
 * `23503`. A delete button would work on a fresh event and fail opaquely on
 * the event with an operational history behind it, which is the wrong way
 * round. Archiving behaves identically on every event, so archiving is what
 * the UI offers. See migration 20260816120000.
 *
 * No permission check in TypeScript. `events` is
 * `update using (app.is_admin()) with check (app.is_admin())`, so a
 * non-admin's write comes back `42501` and is reported as such.
 */
export type ArchiveEventResult = { ok: true } | { ok: false; error: string }

/**
 * Confirmation is by typing the event's own name, compared case-insensitively
 * on trimmed values.
 *
 * The name and not the code: codes are four-to-ten characters and two of them
 * differ by one digit (`E00000` / `E12345`), so typing one is no evidence you
 * looked at the right row. A name is long enough that copying it out is a
 * deliberate act — which is the entire point of the gesture.
 */
function nameMatches(typed: string, actual: string): boolean {
  return typed.trim().toLowerCase() === actual.trim().toLowerCase()
}

export async function archiveEvent(
  eventId: string,
  typedName: string,
): Promise<ArchiveEventResult> {
  const supabase = await createClient()

  // Read the name back from the database rather than trusting one passed
  // through the form: the value being confirmed against must be the value
  // stored, or the confirmation checks nothing.
  const { data: event, error: readErr } = await supabase
    .from('events')
    .select('id, name, archived_at')
    .eq('id', eventId)
    .maybeSingle()

  if (readErr) {
    if (readErr.code === RLS_DENIED) {
      return { ok: false, error: 'Only an admin can archive an event.' }
    }
    return { ok: false, error: `Could not read the event: ${friendlyDbError(readErr)}` }
  }
  if (!event) return { ok: false, error: 'That event no longer exists.' }
  if (event.archived_at) return { ok: false, error: 'That event is already archived.' }

  if (!nameMatches(typedName, event.name)) {
    return {
      ok: false,
      error: `That does not match. Type the event name exactly: ${event.name}`,
    }
  }

  const { error } = await supabase
    .from('events')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', eventId)

  if (error) {
    if (error.code === RLS_DENIED) {
      return { ok: false, error: 'Only an admin can archive an event.' }
    }
    return { ok: false, error: friendlyDbError(error) }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Restore is deliberately asymmetric — no typed confirmation.
 *
 * Archiving hides data; restoring reveals it. Only one of those can be a
 * mistake worth guarding against, and putting friction on the recovery path
 * is how a reversible action stops feeling reversible.
 */
export async function unarchiveEvent(eventId: string): Promise<ArchiveEventResult> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('events')
    .update({ archived_at: null })
    .eq('id', eventId)

  if (error) {
    if (error.code === RLS_DENIED) {
      return { ok: false, error: 'Only an admin can restore an event.' }
    }
    return { ok: false, error: friendlyDbError(error) }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
