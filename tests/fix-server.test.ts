import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { parsePhone } from '@/lib/messaging/provider'
import { buildRpcPayload, EMPTY_LEG_FORM_VALUES, type ReviewFormValues } from '@/lib/review/payload'
import { commitFamilySchema } from '@/lib/actions/import'
import { normaliseHotelName } from '@/lib/actions/hotels'
import { getTodayDateIST } from '@/lib/utils'
import { telHref, formatMobile } from '@/lib/phone'

describe('FIX-SERVER: B3 - parsePhone defaults Indian mobile numbers to 91', () => {
  it('parses a bare 10-digit Indian mobile number with countryCode 91', () => {
    const result = parsePhone('9876543210')
    expect(result).not.toBeNull()
    expect(result?.countryCode).toBe('91')
    expect(result?.phoneNumber).toBe('9876543210')
  })

  it('parses a formatted Indian number with spaces and dashes', () => {
    const result = parsePhone('98765-43210')
    expect(result).not.toBeNull()
    expect(result?.countryCode).toBe('91')
    expect(result?.phoneNumber).toBe('9876543210')
  })

  it('parses an international number with explicit + country code', () => {
    const result = parsePhone('+14155552671')
    expect(result).not.toBeNull()
    expect(result?.countryCode).toBe('1')
    expect(result?.phoneNumber).toBe('4155552671')
  })
})

describe('FIX-SERVER: B4 - buildRpcPayload excludes rejected fields', () => {
  const formValues: ReviewFormValues = {
    rsvpStatus: 'confirmed',
    confirmedPax: '4',
    side: 'bride',
    remarks: 'Need ground floor room',
    arrival: {
      mode: 'flight',
      date: '2026-11-20',
      time: '14:30',
      reference: '6E 204',
      point: 'T2',
      pax: '4',
    },
    departure: EMPTY_LEG_FORM_VALUES,
  }

  it('includes all accepted fields when none are rejected', () => {
    const payload = buildRpcPayload(formValues, {})
    expect(payload.rsvp_status).toBe('confirmed')
    expect(payload.confirmed_pax).toBe(4)
    expect(payload.side).toBe('bride')
    expect(payload.remarks).toBe('Need ground floor room')
    expect(payload.arrival?.mode).toBe('flight')
  })

  it('excludes fields where decision is rejected', () => {
    const payload = buildRpcPayload(formValues, {
      confirmedPax: 'rejected',
      remarks: 'rejected',
    })
    expect(payload.rsvp_status).toBe('confirmed')
    expect(payload.confirmed_pax).toBeUndefined()
    expect(payload.remarks).toBeUndefined()
    expect(payload.side).toBe('bride')
  })

  it('excludes arrival field when arrival mode or leg is rejected', () => {
    const payload = buildRpcPayload(formValues, {
      'arrival.mode': 'rejected',
      'arrival.reference': 'rejected',
    })
    expect(payload.arrival?.mode).toBeUndefined()
    expect(payload.arrival?.reference).toBeUndefined()
    expect(payload.arrival?.date).toBe('2026-11-20')
  })
})

describe('FIX-SERVER: B9 - commitFamilySchema parses remarks and rsvpStatus', () => {
  it('accepts remark and rsvpStatus fields', () => {
    const emptyLeg = {
      travelDate: null,
      travelTime: null,
      mode: null,
      reference: null,
      point: null,
      hasAnyValue: false,
    }
    const row = {
      rowNumber: 1,
      raw: {},
      familyNumber: 'F01',
      headName: 'Rajesh Sharma',
      primaryMobile: '9876543210',
      place: 'Mumbai',
      expectedPax: 3,
      remark: 'Allergic to peanuts',
      rsvpStatus: 'confirmed',
      canImport: true,
      blockReason: null,
      arrival: emptyLeg,
      departure: emptyLeg,
    }
    const parsed = commitFamilySchema.safeParse(row)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.remark).toBe('Allergic to peanuts')
      expect(parsed.data.rsvpStatus).toBe('confirmed')
    }
  })

  it('handles optional rsvpStatus and remark', () => {
    const emptyLeg = {
      travelDate: null,
      travelTime: null,
      mode: null,
      reference: null,
      point: null,
      hasAnyValue: false,
    }
    const row = {
      rowNumber: 2,
      raw: {},
      familyNumber: 'F02',
      headName: 'Pooja Patel',
      primaryMobile: '9876543211',
      place: null,
      expectedPax: 2,
      canImport: true,
      blockReason: null,
      arrival: emptyLeg,
      departure: emptyLeg,
    }
    const parsed = commitFamilySchema.safeParse(row)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.remark).toBeUndefined()
      expect(parsed.data.rsvpStatus).toBeUndefined()
    }
  })
})

describe('FIX-SERVER: M39 - normaliseHotelName', () => {
  it('normalises casing, extra spaces, and trims correctly', () => {
    expect(normaliseHotelName('  Taj   Palace  ')).toBe('taj palace')
    expect(normaliseHotelName('GRAND HYATT')).toBe('grand hyatt')
    expect(normaliseHotelName('JW   Marriott   Resort ')).toBe('jw marriott resort')
  })
})

describe('FIX-SERVER: M44 - getTodayDateIST', () => {
  it('returns a valid YYYY-MM-DD date matching IST', () => {
    const today = getTodayDateIST()
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('FIX-SERVER: M46 - telHref and formatMobile', () => {
  it('generates correct tel: href and formatted mobile for Indian mobile numbers', () => {
    expect(telHref('9876543210')).toBe('tel:+919876543210')
    expect(formatMobile('9876543210')).toBe('98765 43210')
  })

  it('returns null telHref for garbage phone numbers', () => {
    expect(telHref('not-a-number')).toBeNull()
    expect(telHref('')).toBeNull()
    expect(telHref(null)).toBeNull()
  })

  it('handles international numbers with + prefix', () => {
    expect(telHref('+14155552671')).toBe('tel:+14155552671')
    expect(formatMobile('+14155552671')).toBe('+14155552671')
  })
})
