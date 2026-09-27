import { describe, expect, it } from 'vitest'

import {
  bucketHref,
  callsHref,
  dashboardLinks,
  familyHref,
  parseFamilyParam,
  parseFilterParam,
} from '@/lib/admin/dashboard-links'

const ID = '3f2b8c1a-9d4e-4c7a-8b21-0e5f6a7b8c9d'

describe('admin dashboard links', () => {
  it('sends every counter to a staff screen under the event code', () => {
    const links = dashboardLinks('UNICOS279')
    for (const href of Object.values(links)) {
      expect(href.startsWith('/UNICOS279/')).toBe(true)
    }
    expect(links.pending).toBe('/UNICOS279/rsvp/queue?filter=to_call')
    expect(links.confirmed).toBe('/UNICOS279/rsvp/queue?filter=coming')
    expect(links.rooms).toBe('/UNICOS279/hospitality/rooms')
  })

  it('maps each confirmation bucket to a Calls filter that exists', () => {
    expect(bucketHref('E1', 'confirmed')).toBe('/E1/rsvp/queue?filter=coming')
    expect(bucketHref('E1', 'not_called')).toBe('/E1/rsvp/queue?filter=to_call')
    expect(bucketHref('E1', 'maybe')).toBe('/E1/rsvp/queue?filter=all')
    for (const bucket of ['confirmed', 'not_coming', 'maybe', 'no_answer', 'not_called'] as const) {
      const filter = new URL(bucketHref('E1', bucket), 'https://x').searchParams.get('filter')
      expect(parseFilterParam(filter ?? undefined)).not.toBeNull()
    }
  })

  it('opens a family on the Calls screen, never the lock-claiming record', () => {
    expect(familyHref('E1', ID)).toBe(`/E1/rsvp/queue?family=${ID}`)
    expect(familyHref('E1', ID)).not.toContain('/rsvp/status/')
    expect(callsHref('E1')).toBe('/E1/rsvp/queue')
  })
})

describe('query params', () => {
  it('accepts only real filter chips', () => {
    expect(parseFilterParam('coming')).toBe('coming')
    expect(parseFilterParam(['no_answer', 'x'])).toBe('no_answer')
    expect(parseFilterParam('maybe')).toBeNull()
    expect(parseFilterParam(undefined)).toBeNull()
  })

  it('accepts only a uuid as a family id', () => {
    expect(parseFamilyParam(ID)).toBe(ID)
    expect(parseFamilyParam('1; drop table')).toBeNull()
    expect(parseFamilyParam(undefined)).toBeNull()
  })
})
