/**
 * Tying a recording file to a family.
 *
 * The fallback this covers is what makes the whole feature work for its actual
 * use: staff dial from the phone's own dialer, so there is no `call_attempts`
 * row to match against and the time-window rule finds nothing. Matching on the
 * number in the filename is the only remaining signal.
 *
 * It is also the most dangerous step in the pipeline. Filing audio against the
 * wrong family puts one family's answers into another family's record, where
 * the review screen presents them as that family's own — so the ambiguous
 * cases are asserted as hard refusals, not as best guesses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { matchRecording } from '@/lib/harvest-match'

type Row = Record<string, unknown>

/**
 * A chainable stub shaped like the PostgREST builder. Every filter returns
 * `this`; awaiting the builder resolves the table's rows. That is enough for
 * this module, which only ever filters and then awaits.
 */
function stubClient(tables: { call_attempts?: Row[]; guest_groups?: Row[] }) {
  function builder(rows: Row[]) {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'order']) {
      chain[method] = () => chain
    }
    chain.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null })
    return chain
  }

  return {
    from: (table: string) =>
      builder(tables[table as keyof typeof tables] ?? []),
  }
}

const EVENT = 'e1'
const MTIME = Date.parse('2026-10-28T09:05:00Z')

function input(over: Partial<Parameters<typeof matchRecording>[0]> = {}) {
  return {
    filePath: '/Recordings/Call/Call_9876543210_20261028.m4a',
    fileSize: 100_000,
    fileMtime: MTIME,
    durationSec: 60,
    eventId: EVENT,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('matchRecording', () => {
  it('prefers an in-app call attempt in the time window', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubClient({
        call_attempts: [
          {
            id: 'a1',
            group_id: 'g-dialled-in-app',
            dialed_number: '9000000000',
            started_at: new Date(MTIME - 30_000).toISOString(),
            outcome: 'connected',
          },
        ],
        // A different family owns the number in the filename. The window match
        // must win, or an in-app call would be filed by filename instead.
        guest_groups: [{ id: 'g-from-filename', primary_mobile: '9876543210', alt_mobile: null }],
      }) as never,
    )

    const result = await matchRecording(input())
    expect(result).toMatchObject({
      kind: 'matched',
      callAttemptId: 'a1',
      groupId: 'g-dialled-in-app',
      via: 'call-window',
    })
  })

  it('falls back to the filename number when nothing was dialled from the app', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubClient({
        call_attempts: [],
        guest_groups: [
          { id: 'g-other', primary_mobile: '9111111111', alt_mobile: null },
          { id: 'g-match', primary_mobile: '9876543210', alt_mobile: null },
        ],
      }) as never,
    )

    const result = await matchRecording(input())
    expect(result).toMatchObject({
      kind: 'matched',
      callAttemptId: null,
      groupId: 'g-match',
      via: 'filename-phone',
    })
  })

  it('matches the alternate number too', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubClient({
        call_attempts: [],
        guest_groups: [{ id: 'g-alt', primary_mobile: '9111111111', alt_mobile: '9876543210' }],
      }) as never,
    )

    const result = await matchRecording(input())
    expect(result).toMatchObject({ kind: 'matched', groupId: 'g-alt', via: 'filename-phone' })
  })

  it('normalises +91 and leading zeros before comparing', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubClient({
        call_attempts: [],
        guest_groups: [{ id: 'g-91', primary_mobile: '09876543210', alt_mobile: null }],
      }) as never,
    )

    const result = await matchRecording(
      input({ filePath: '/Recordings/Call/+919876543210_20261028_1430.m4a' }),
    )
    expect(result).toMatchObject({ kind: 'matched', groupId: 'g-91' })
  })

  it('refuses to guess when one number belongs to two families', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubClient({
        call_attempts: [],
        guest_groups: [
          { id: 'g-father', primary_mobile: '9876543210', alt_mobile: null },
          { id: 'g-son', primary_mobile: '9876543210', alt_mobile: null },
        ],
      }) as never,
    )

    const result = await matchRecording(input())
    expect(result.kind).toBe('unmatched')
  })

  it('is unmatched when the filename number is not on the guest list', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubClient({
        call_attempts: [],
        guest_groups: [{ id: 'g1', primary_mobile: '9111111111', alt_mobile: null }],
      }) as never,
    )

    const result = await matchRecording(input())
    expect(result.kind).toBe('unmatched')
  })

  it('is unmatched when the filename carries no number at all', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubClient({
        call_attempts: [],
        guest_groups: [{ id: 'g1', primary_mobile: '9876543210', alt_mobile: null }],
      }) as never,
    )

    const result = await matchRecording(input({ filePath: '/Recordings/Call/recording.m4a' }))
    expect(result.kind).toBe('unmatched')
  })

  it('sets callKind to reminder when in-app attempt was a reminder call', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubClient({
        call_attempts: [
          {
            id: 'a-rem',
            group_id: 'g-rem',
            dialed_number: '9000000000',
            started_at: new Date(MTIME - 30_000).toISOString(),
            outcome: 'connected',
            call_kind: 'reminder',
          },
        ],
        guest_groups: [],
      }) as never,
    )

    const result = await matchRecording(input())
    expect(result).toMatchObject({
      kind: 'matched',
      callAttemptId: 'a-rem',
      groupId: 'g-rem',
      via: 'call-window',
      callKind: 'reminder',
    })
  })

  it('sets callKind to first for filename-phone fallback matches', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubClient({
        call_attempts: [],
        guest_groups: [{ id: 'g-ph', primary_mobile: '9876543210', alt_mobile: null }],
      }) as never,
    )

    const result = await matchRecording(input())
    expect(result).toMatchObject({
      kind: 'matched',
      callAttemptId: null,
      groupId: 'g-ph',
      via: 'filename-phone',
      callKind: 'first',
    })
  })
})
