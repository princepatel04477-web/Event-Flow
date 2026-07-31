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

  const { data, error } = await supabase
    .from('events')
    .insert({
      name: values.name,
      code: values.code,
      bride_name: orNull(values.brideName),
      groom_name: orNull(values.groomName),
      starts_on: values.startsOn,
      ends_on: orNull(values.endsOn),
      created_by: user.id,
    })
    .select('code')
    .single()

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

  // `redirect` throws, so it must stay outside any try/catch. `data.code` is
  // what the database actually stored; prefer it over what we sent.
  redirect(`/${data?.code ?? values.code}`)
}
