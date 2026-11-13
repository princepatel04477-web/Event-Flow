import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/auth/server', () => ({
  getSessionClaims: vi.fn(async () => ({ staffMemberId: 'staff-1' })),
}))

vi.mock('@/lib/media/names', () => ({
  r2BucketValue: vi.fn(() => 'eventflow-call-recordings'),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { registerHarvestedRecording } from '@/lib/actions/harvest'

const EVENT_ID = 'e1111111-1111-1111-1111-111111111111'

describe('registerHarvestedRecording — reminder call backstop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects registration when call_attempt is a reminder call', async () => {
    const insertMock = vi.fn()

    const mockSupabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
      from: vi.fn((table: string) => {
        if (table === 'call_attempts') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { call_kind: 'reminder' },
                    error: null,
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'call_recordings') {
          return {
            insert: insertMock,
          }
        }
        return {}
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never)

    const result = await registerHarvestedRecording({
      eventId: EVENT_ID,
      eventCode: 'E1',
      groupId: 'g1',
      callAttemptId: 'att-reminder',
      storagePath: `${EVENT_ID}/g1/rec.m4a`,
      mimeType: 'audio/mp4',
      durationSec: 60,
      consentGiven: true,
    })

    expect(result).toEqual({ ok: false, error: 'Reminder call: not recorded.' })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('proceeds with insert when call_attempt is a first call', async () => {
    const singleMock = vi.fn(async () => ({
      data: { id: 'rec-1' },
      error: null,
    }))
    const selectMock = vi.fn(() => ({ single: singleMock }))
    const insertMock = vi.fn(() => ({ select: selectMock }))

    const mockSupabase = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
      from: vi.fn((table: string) => {
        if (table === 'call_attempts') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { call_kind: 'first' },
                    error: null,
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'call_recordings') {
          return {
            insert: insertMock,
          }
        }
        return {}
      }),
    }

    vi.mocked(createClient).mockResolvedValue(mockSupabase as never)

    const result = await registerHarvestedRecording({
      eventId: EVENT_ID,
      eventCode: 'E1',
      groupId: 'g1',
      callAttemptId: 'att-first',
      storagePath: `${EVENT_ID}/g1/rec.m4a`,
      mimeType: 'audio/mp4',
      durationSec: 60,
      consentGiven: true,
    })

    expect(result).toEqual({ ok: true, recordingId: 'rec-1' })
    expect(insertMock).toHaveBeenCalledTimes(1)
  })
})
