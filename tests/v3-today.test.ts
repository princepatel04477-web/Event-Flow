import { describe, expect, it } from 'vitest'

import {
  attentionJobs,
  attentionRows,
  departmentJob,
  moreNumbers,
  nowJob,
  progressBars,
  type StaffFocus,
  type TodayNumbers,
} from '@/app/(app)/v2/[eventCode]/_home/today'

/**
 * Today's view model.
 *
 * Written under the same constraint as `v3-shell-render.test.ts`: this sandbox
 * denies the named pipe Chromium's mojo layer needs, so no screenshot could be
 * taken and "what does the week's worst event look like on a 360px screen" had
 * to be checked as arithmetic instead. What is pinned here is the part of
 * Today that decides *what* is rendered — which counter becomes the Now card,
 * which bars exist at all, and the cap of three.
 */

const numbers = (over: Partial<TodayNumbers> = {}): TodayNumbers => ({
  totalGroups: 238,
  totalPax: 465,
  rsvpConfirmed: 190,
  rsvpPending: 40,
  guestsRoomed: 300,
  hampersDelivered: 120,
  hampersPending: 30,
  arrivalsToday: 44,
  departuresToday: 12,
  confirmedNoRoom: 17,
  arrivalsNoVehicle: 3,
  noDeparture: 18,
  ...over,
})

describe('attentionJobs', () => {
  it('drops a zero counter rather than rendering it as a satisfied row', () => {
    const jobs = attentionJobs(numbers({ arrivalsNoVehicle: 0, hampersPending: 0 }), 'SHARMA26')
    expect(jobs.map((j) => j.id)).toEqual(['noDeparture', 'confirmedNoRoom'])
  })

  it('puts the largest count first', () => {
    const jobs = attentionJobs(numbers(), 'SHARMA26')
    // 30 hampers, 18 no-departure, 17 no-room, 3 no-car.
    expect(jobs.map((j) => j.id)).toEqual([
      'hampersPending',
      'noDeparture',
      'confirmedNoRoom',
      'arrivalsNoVehicle',
    ])
  })

  it('breaks a tie by how late it is to fix, not by insertion order of the view', () => {
    const jobs = attentionJobs(
      numbers({ arrivalsNoVehicle: 0, hampersPending: 0, noDeparture: 5, confirmedNoRoom: 5 }),
      'SHARMA26',
    )
    expect(jobs.map((j) => j.id)).toEqual(['confirmedNoRoom', 'noDeparture'])
  })

  it('singularises a count of one', () => {
    const [job] = attentionJobs(
      numbers({ confirmedNoRoom: 1, arrivalsNoVehicle: 0, noDeparture: 0, hampersPending: 0 }),
      'SHARMA26',
    )
    expect(job.headline).toBe('1 guest has no room')
  })

  it('renders every href against the event code it was given', () => {
    for (const job of attentionJobs(numbers(), 'ABC')) {
      expect(job.href.startsWith('/ABC/')).toBe(true)
    }
  })

  it('returns nothing at all when the event is clean', () => {
    expect(
      attentionJobs(
        numbers({ confirmedNoRoom: 0, arrivalsNoVehicle: 0, noDeparture: 0, hampersPending: 0 }),
        'ABC',
      ),
    ).toEqual([])
  })
})

describe('nowJob', () => {
  it('gives management the worst counter, whatever it is', () => {
    const jobs = attentionJobs(numbers(), 'E')
    expect(nowJob(jobs, 'management', 'E').id).toBe('hampersPending')
  })

  it('gives a department its OWN job even when another counter is larger', () => {
    // A hamper runner cannot place families. Handing them the 17-no-room card
    // would be a card they can only dismiss.
    const jobs = attentionJobs(numbers(), 'E')
    expect(nowJob(jobs, 'hamper', 'E').id).toBe('hampersPending')
    expect(nowJob(jobs, 'hospitality', 'E').id).toBe('confirmedNoRoom')
    expect(nowJob(jobs, 'logistics', 'E').id).toBe('arrivalsNoVehicle')
  })

  it('falls back to the worst counter when the department has no job of its own', () => {
    const jobs = attentionJobs(numbers({ arrivalsNoVehicle: 0, hampersPending: 0 }), 'E')
    expect(nowJob(jobs, 'logistics', 'E').id).toBe('noDeparture')
  })

  it('never returns a dead end when there is nothing wrong', () => {
    for (const focus of [
      'management',
      'logistics',
      'hospitality',
      'hamper',
      'production',
    ] as StaffFocus[]) {
      const job = nowJob([], focus, 'E')
      expect(job.id).toBe('default')
      expect(job.href.startsWith('/E/')).toBe(true)
      expect(job.actionLabel.length).toBeGreaterThan(0)
    }
  })

  it('has a distinct calm action per department', () => {
    const hrefs = (['management', 'logistics', 'hospitality', 'hamper', 'production'] as StaffFocus[]).map(
      (f) => departmentJob(f, 'E').href,
    )
    expect(new Set(hrefs).size).toBe(5)
  })
})

describe('attentionRows', () => {
  it('caps the list at three and never repeats the Now card', () => {
    const jobs = attentionJobs(numbers(), 'E')
    const now = nowJob(jobs, 'management', 'E')
    const rest = attentionRows(jobs, now)
    expect(rest.length).toBeLessThanOrEqual(3)
    expect(rest.some((j) => j.id === now.id)).toBe(false)
  })
})

describe('progressBars', () => {
  it('drops a bar with no denominator', () => {
    // 0/0 is not "finished" — it is "nothing imported", and the bar must not
    // exist rather than sit empty at the top of the screen.
    const bars = progressBars(numbers({ totalPax: 0, guestsRoomed: 0 }), 'hospitality')
    expect(bars.map((b) => b.label)).not.toContain('Guests with a bed')
    expect(bars.map((b) => b.label)).toEqual(['Families called'])
  })

  it('shows at most three and puts the department’s own bar first', () => {
    const bars = progressBars(numbers(), 'hamper')
    expect(bars.length).toBeLessThanOrEqual(3)
    expect(bars[0].label).toBe('Hampers delivered')
    expect(bars[0].tone).toBe('amber')
  })

  it('gives management all three domains in the documented tones', () => {
    const bars = progressBars(numbers(), 'management')
    expect(bars.map((b) => b.tone)).toEqual(['green', 'brand', 'amber'])
  })

  it('counts "called" as families minus those still to call', () => {
    const [calls] = progressBars(numbers({ totalGroups: 238, rsvpPending: 40 }), 'production')
    expect(calls.done).toBe(198)
    expect(calls.total).toBe(238)
  })

  it('never goes negative when the counts disagree', () => {
    const [calls] = progressBars(numbers({ totalGroups: 10, rsvpPending: 40 }), 'production')
    expect(calls.done).toBe(0)
  })

  it('adds delivered and pending for the hamper denominator', () => {
    const [hamper] = progressBars(numbers({ hampersDelivered: 120, hampersPending: 30 }), 'hamper')
    expect(hamper.done + 0).toBe(120)
    expect(hamper.total).toBe(150)
  })
})

describe('moreNumbers', () => {
  it('is the admin disclosure, and is only the counters that are not actions', () => {
    const rows = moreNumbers(numbers())
    expect(rows.map((r) => r.label)).toEqual([
      'Guests expected',
      'Families',

      'Confirmed',
      'Still to call',
    ])
  })
})
