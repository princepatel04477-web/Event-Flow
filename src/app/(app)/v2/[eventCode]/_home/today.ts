/**
 * The arithmetic behind Today, as pure functions.
 *
 * WHY THIS IS A MODULE AND NOT INLINE IN THE PAGE. SPEC-V3 §5 allows "pure
 * view helpers with tests" and nothing else, so every decision Today makes
 * about *which* number becomes the Now card, *which* bars appear and *in what
 * order* lives here, where `tests/v3-today.test.ts` can pin it. The page is
 * then left with fetching, guarding and layout.
 *
 * THE ONE RULE THAT MATTERS: a bar is only shown when it has a denominator.
 * A "Guests with a bed 0/0" bar on an event where nothing has been imported
 * tells a runner the work is finished; `progressPercent` already refuses to
 * paint it a hundred percent, and this module refuses to render it at all.
 */

/** The five field departments (`staff_members.department`). */
export type StaffFocus = 'management' | 'logistics' | 'hospitality' | 'hamper' | 'production'

/**
 * Everything Today reads off the board. Deliberately structural rather than a
 * re-export of `BoardRow`, so the degraded numbers (see `visibleNumbers.ts`)
 * can satisfy it without inventing values for fields they cannot compute.
 */
export interface TodayNumbers {
  totalGroups: number
  totalPax: number
  rsvpConfirmed: number
  rsvpPending: number
  guestsRoomed: number
  hampersDelivered: number
  hampersPending: number
  arrivalsToday: number
  departuresToday: number
  confirmedNoRoom: number
  arrivalsNoVehicle: number
  noDeparture: number
}

export type JobId = 'confirmedNoRoom' | 'arrivalsNoVehicle' | 'noDeparture' | 'hampersPending' | 'default'

export interface TodayJob {
  id: JobId
  /** One short sentence — the Now card headline, or a Row's heading. */
  headline: string
  /** One line under it. Facts only, no second sentence. */
  context: string
  actionLabel: string
  href: string
  /** A Row status word. Empty on the calm default, which is not a problem. */
  status: string
}

/** The four attention counters, each with the words it needs to be read. */
const JOBS: Record<
  Exclude<JobId, 'default'>,
  {
    headline: (n: number) => string
    context: string
    actionLabel: string
    path: string
    status: string
  }
> = {
  confirmedNoRoom: {
    headline: (n) => `${n} ${n === 1 ? 'guest has' : 'guests have'} no room`,
    context: 'Confirmed, and nowhere to sleep yet.',
    actionLabel: 'Place families',
    path: 'hospitality/rooms',
    status: 'No room',
  },
  arrivalsNoVehicle: {
    headline: (n) => `${n} ${n === 1 ? 'arrival has' : 'arrivals have'} no car`,
    context: 'Arriving today with nobody meeting them.',
    actionLabel: 'Assign cars',
    path: 'logistics/fleet',
    status: 'No car',
  },
  noDeparture: {
    headline: (n) => `${n} ${n === 1 ? 'guest has' : 'guests have'} no departure`,
    context: 'Checked in, with no leaving time recorded.',
    actionLabel: 'Log departures',
    path: 'logistics/departures',
    status: 'No date',
  },
  hampersPending: {
    headline: (n) => `${n} ${n === 1 ? 'hamper' : 'hampers'} to deliver`,
    context: 'Every delivery needs a photo as proof.',
    actionLabel: 'Deliver hampers',
    path: 'hospitality/deliveries',
    status: 'To deliver',
  },
}

/** The order below is also the tie-break — see `attentionJobs`. */
const JOB_ORDER: Array<Exclude<JobId, 'default'>> = [
  'confirmedNoRoom',
  'arrivalsNoVehicle',
  'noDeparture',
  'hampersPending',
]

/**
 * The attention counters that are non-zero, worst first.
 *
 * THE ORDER IS THE ADVICE. Equal counts keep `JOB_ORDER`, which is the order
 * of how late it is to fix each one — a family with no bed at 11pm is worse
 * than a hamper with no photo. A count of zero is not a job, so it is dropped
 * rather than rendered as a satisfied row.
 */
export function attentionJobs(n: TodayNumbers, eventCode: string): TodayJob[] {
  return JOB_ORDER.map((id) => ({ id, count: n[id] }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(({ id, count }) => {
      const spec = JOBS[id]
      return {
        id,
        headline: spec.headline(count),
        context: spec.context,
        actionLabel: spec.actionLabel,
        href: `/${eventCode}/${spec.path}`,
        status: spec.status,
      }
    })
}

/** Which job a department should be handed first, when it owns one. */
const DEPARTMENT_JOB: Record<StaffFocus, Exclude<JobId, 'default'> | null> = {
  management: null, // the worst one, whatever it is
  logistics: 'arrivalsNoVehicle',
  hospitality: 'confirmedNoRoom',
  hamper: 'hampersPending',
  production: null, // no production counter exists on the board
}

/** What to do when nothing is wrong — one per department, never a dead end. */
const CALM_JOBS: Record<StaffFocus, Omit<TodayJob, 'href'> & { path: string }> = {
  management: {
    id: 'default',
    headline: 'Call the next family',
    context: 'Nothing else needs you right now.',
    actionLabel: 'Start calling',
    path: 'rsvp/queue',
    status: '',
  },
  logistics: {
    id: 'default',
    headline: 'Check today’s arrivals',
    context: 'Nothing is missing a vehicle right now.',
    actionLabel: 'Open arrivals',
    path: 'logistics/arrivals',
    status: '',
  },
  hospitality: {
    id: 'default',
    headline: 'Every guest has a bed',
    context: 'Nobody is waiting for a room right now.',
    actionLabel: 'Open rooms',
    path: 'hospitality/rooms',
    status: '',
  },
  hamper: {
    id: 'default',
    headline: 'Every hamper is delivered',
    context: 'Nothing is waiting on a photo right now.',
    actionLabel: 'Open hampers',
    path: 'hospitality/deliveries',
    status: '',
  },
  production: {
    id: 'default',
    headline: 'Walk your setup list',
    context: 'Your items for this event.',
    actionLabel: 'Open setup',
    path: 'production',
    status: '',
  },
}

/** The department's own next action, whether or not the board answered. */
export function departmentJob(focus: StaffFocus, eventCode: string): TodayJob {
  const calm = CALM_JOBS[focus]
  const { path, ...rest } = calm
  return { ...rest, href: `/${eventCode}/${path}` }
}

/**
 * The ONE thing the Now card says.
 *
 * A department that owns a domain gets its own job even when another counter
 * is larger: a hamper runner cannot place families, so handing them that card
 * would be a card they can only dismiss. Management gets the worst counter.
 */
export function nowJob(jobs: TodayJob[], focus: StaffFocus, eventCode: string): TodayJob {
  const preferred = DEPARTMENT_JOB[focus]
  if (preferred) {
    const mine = jobs.find((job) => job.id === preferred)
    if (mine) return mine
  }
  return jobs[0] ?? departmentJob(focus, eventCode)
}

/** The jobs that lost the Now card, for "Needs attention". Capped at 3 (§4). */
export function attentionRows(jobs: TodayJob[], now: TodayJob): TodayJob[] {
  return jobs.filter((job) => job.id !== now.id).slice(0, 3)
}

export interface TodayBar {
  label: string
  done: number
  total: number
  tone: 'green' | 'brand' | 'amber'
}

/**
 * Up to three bars, the department's own first.
 *
 * The CALLS bar is in every department's set on purpose: it is the one number
 * on this event every department can act on (a family that has not been called
 * has no arrival to meet, no room to hold and no hamper address), and it is
 * what "done" means for the event as a whole.
 *
 * A bar with no denominator is dropped — see the module header.
 */
export function progressBars(n: TodayNumbers, focus: StaffFocus): TodayBar[] {
  const called = Math.max(0, n.totalGroups - n.rsvpPending)
  const hampersTotal = n.hampersDelivered + n.hampersPending

  const calls: TodayBar = { label: 'Families called', done: called, total: n.totalGroups, tone: 'green' }
  const rooms: TodayBar = { label: 'Guests with a bed', done: n.guestsRoomed, total: n.totalPax, tone: 'brand' }
  const hampers: TodayBar = {
    label: 'Hampers delivered',
    done: n.hampersDelivered,
    total: hampersTotal,
    tone: 'amber',
  }

  const ordered: Record<StaffFocus, TodayBar[]> = {
    management: [calls, rooms, hampers],
    logistics: [calls, rooms],
    hospitality: [rooms, calls],
    hamper: [hampers, calls],
    production: [calls],
  }

  return ordered[focus].filter((bar) => bar.total > 0).slice(0, 3)
}

/**
 * The counters that live behind the "More numbers" disclosure (§4: admin-only
 * extra counters go below it). Kept out of the main flow on purpose: none of
 * them is an action, and six figures stacked above the fold is the v2 screen
 * this rebuild deleted.
 */
export function moreNumbers(n: TodayNumbers): Array<{ label: string; value: number }> {
  return [
    { label: 'Guests expected', value: n.totalPax },
    { label: 'Families', value: n.totalGroups },
    { label: 'Confirmed', value: n.rsvpConfirmed },
    { label: 'Still to call', value: n.rsvpPending },
  ]
}
