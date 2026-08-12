/**
 * Shared types + validation for the RSVP logging form (p1f.5).
 *
 * Deliberately dependency-free of `server-only` / Supabase so both the
 * client form (`RsvpLogForm`) and the server action (`lib/actions/rsvp.ts`)
 * can import it. Zod is the single source of validation truth for the form.
 */
import { z } from 'zod'

import type { Database } from '@/lib/supabase/database.types'
import { TRAVEL_MODE_OPTIONS } from '@/lib/review/payload'

export type RsvpStatus = Database['app']['Enums']['rsvp_status']
export type TravelMode = Database['app']['Enums']['travel_mode']
export type GuestGroupRow = Database['public']['Tables']['guest_groups']['Row']
export type TravelLegRow = Database['public']['Tables']['travel_legs']['Row']

/** The multi-select needs a caller can tick after the call. */
export const SPECIAL_REQUIREMENTS_OPTIONS = [
  { value: 'elderly', label: 'Elderly' },
  { value: 'wheelchair', label: 'Wheelchair' },
  { value: 'infant', label: 'Infant' },
  { value: 'dietary', label: 'Dietary' },
  { value: 'medical', label: 'Medical' },
] as const

export type SpecialRequirement = (typeof SPECIAL_REQUIREMENTS_OPTIONS)[number]['value']

/** `car` in the task brief is `self_drive` in the real schema. */
export const TRAVEL_MODE_OPTIONS_FOR_FORM = TRAVEL_MODE_OPTIONS

/** The statuses the outcome form offers, in call-answer priority order. */
export const RSVP_LOG_STATUS_OPTIONS: RsvpStatus[] = [
  'confirmed',
  'declined',
  'tentative',
  'callback',
  'unreachable',
]

/** Statuses that end the form immediately — nothing below the status needs answering. */
export const TERMINAL_STATUSES: ReadonlySet<RsvpStatus> = new Set(['declined', 'unreachable'])

/** Statuses that MUST carry head counts (the person said yes — how many people?). */
export const CONFIRMING_STATUSES: ReadonlySet<RsvpStatus> = new Set(['confirmed', 'tentative'])

/**
 * A single leg (arrival or departure) as the form edits it. Blank strings
 * mean "not captured"; the action's leg-builder turns blank into "leave
 * the existing value alone" (see lib/actions/rsvp.ts), never into an
 * accidental cleared field.
 */
export interface LegFormValues {
  mode: string
  date: string
  time: string
  location: string
  flightTrainNo: string
}

export const EMPTY_LEG: LegFormValues = {
  mode: '',
  date: '',
  time: '',
  location: '',
  flightTrainNo: '',
}

/** Everything the outcome form holds. All strings (native inputs), as the review form does. */
export interface RsvpLogFormValues {
  rsvpStatus: RsvpStatus | ''
  adultsConfirmed: string
  childrenConfirmed: string
  needsPickup: boolean
  specialRequirements: SpecialRequirement[]
  callbackDatetime: string
  notes: string
  arrival: LegFormValues
  departure: LegFormValues
}

export function emptyFormValues(): RsvpLogFormValues {
  return {
    rsvpStatus: '',
    adultsConfirmed: '',
    childrenConfirmed: '',
    needsPickup: false,
    specialRequirements: [],
    callbackDatetime: '',
    notes: '',
    arrival: { ...EMPTY_LEG },
    departure: { ...EMPTY_LEG },
  }
}

/**
 * Convert `guest_groups` + `travel_legs` rows into initial form values.
 * Existing legs win; the DB defaults for dates come from the event window.
 */
export function buildInitialFormValues(
  group: GuestGroupRow,
  legs: TravelLegRow[],
  eventStartsOn: string | null,
  eventEndsOn: string | null,
): RsvpLogFormValues {
  const arrival = legs.find((l) => l.direction === 'arrival')
  const departure = legs.find((l) => l.direction === 'departure')

  const values = emptyFormValues()
  values.rsvpStatus = group.rsvp_status
  values.adultsConfirmed = group.adults_confirmed !== null ? String(group.adults_confirmed) : ''
  values.childrenConfirmed =
    group.children_confirmed !== null ? String(group.children_confirmed) : ''
  values.needsPickup = group.needs_pickup
  values.specialRequirements = (group.special_requirements ?? []) as SpecialRequirement[]
  values.notes = group.remarks ?? ''

  if (arrival) {
    values.arrival = legToFormValues(arrival)
  } else {
    values.arrival.date = defaultDateAround(eventStartsOn, eventEndsOn)
  }

  if (departure) {
    values.departure = legToFormValues(departure)
  } else {
    values.departure.date = defaultDepartureDate(eventStartsOn, eventEndsOn)
  }

  return values
}

function legToFormValues(leg: TravelLegRow): LegFormValues {
  return {
    mode: leg.mode ?? '',
    date: leg.travel_date ?? '',
    time: toTimeInputValue(leg.travel_time),
    location: leg.point ?? '',
    flightTrainNo: leg.reference ?? '',
  }
}

/** Postgres `time` is "HH:MM:SS"; `<input type="time">` wants "HH:MM". */
function toTimeInputValue(value: string | null): string {
  if (!value) return ''
  return value.length >= 5 ? value.slice(0, 5) : value
}

/** The arrival date defaults to the day before the event starts, or the start day. */
export function defaultDateAround(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
): string {
  const base = startsOn ?? endsOn
  if (!base) return ''
  const date = new Date(`${base}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() - 1)
  return toDateInputValue(date)
}

/** The departure date defaults to the day after the event ends, or the end day. */
export function defaultDepartureDate(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
): string {
  const base = endsOn ?? startsOn
  if (!base) return ''
  const date = new Date(`${base}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() + 1)
  return toDateInputValue(date)
}

function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// ---------------------------------------------------------------------------
// Zod schema — the form's single validation source.
// ---------------------------------------------------------------------------

const legSchema = z
  .object({
    mode: z.string(),
    date: z.string(),
    time: z.string(),
    location: z.string(),
    flightTrainNo: z.string(),
  })
  .superRefine((leg, ctx) => {
    if (leg.mode && !leg.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date'],
        message: 'Pick a date for the ' + (leg.mode ? 'travel' : 'journey') + '.',
      })
    }
  })

export const rsvpLogSchema = z
  .object({
    rsvpStatus: z
      .enum(['confirmed', 'declined', 'tentative', 'callback', 'unreachable'], 'How did the call go?'),
    adultsConfirmed: z.string(),
    childrenConfirmed: z.string(),
    needsPickup: z.boolean(),
    specialRequirements: z.array(z.enum(['elderly', 'wheelchair', 'infant', 'dietary', 'medical'])),
    callbackDatetime: z.string(),
    notes: z.string(),
    arrival: legSchema,
    departure: legSchema,
  })
  .superRefine((values, ctx) => {
    // Confirming statuses MUST carry at least one person.
    if (CONFIRMING_STATUSES.has(values.rsvpStatus)) {
      const adults = parseCount(values.adultsConfirmed)
      const children = parseCount(values.childrenConfirmed)
      const total = (adults ?? 0) + (children ?? 0)
      if (total < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['adultsConfirmed'],
          message:
            values.rsvpStatus === 'tentative'
              ? 'How many people are tentatively coming? Add at least one adult or child.'
              : 'How many people are coming? Add at least one adult or child.',
        })
      }
    }

    // Callback status REQUIRES a future callback time.
    if (values.rsvpStatus === 'callback' && !values.callbackDatetime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['callbackDatetime'],
        message: 'Pick when to call back — without a time this family drops out of the callback list.',
      })
    }

    // Arrival must not land after departure.
    const arrivalDate = values.arrival.date
    const departureDate = values.departure.date
    if (arrivalDate && departureDate && arrivalDate > departureDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['arrival.date'],
        message: 'Arrival is after departure — swap the dates.',
      })
    }
  })

export type RsvpLogSchema = z.infer<typeof rsvpLogSchema>

/** Whole non-negative count, or null when blank/not a whole number. */
function parseCount(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) ? n : null
}

/** Parse a form value into a count for the stepper, defaulting to 0 for display. */
export function toDisplayCount(raw: string): number {
  return parseCount(raw) ?? 0
}
