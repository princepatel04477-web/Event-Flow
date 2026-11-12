import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it, test, vi } from 'vitest'

const { createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}))

import { deleteEvent } from '@/lib/actions/events'

function buildActionSupabaseMock(options: {
  eventRow?: { id: string; name: string } | null
  readError?: { code?: string; message: string } | null
  rpcData?: unknown
  rpcError?: { code?: string; message: string } | null
}) {
  const rpc = vi.fn().mockResolvedValue({
    data: options.rpcData ?? { deleted: true },
    error: options.rpcError ?? null,
  })

  const emptyMedia = {
    select: () => ({
      eq: async () => ({ data: [], error: null }),
    }),
  }

  const from = vi.fn((table: string) => {
    if (table === 'events') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: options.eventRow ?? null,
              error: options.readError ?? null,
            }),
          }),
        }),
      }
    }
    return emptyMedia
  })

  return { from, rpc }
}

describe('deleteEvent server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-admin users when reading the event fails with 42501', async () => {
    const mock = buildActionSupabaseMock({
      readError: { code: '42501', message: 'permission denied' },
    })
    createClientMock.mockResolvedValue(mock)

    const res = await deleteEvent('evt-1', 'Sharma Wedding')
    expect(res).toEqual({ ok: false, error: 'Only an admin can delete an event.' })
    expect(mock.rpc).not.toHaveBeenCalled()
  })

  it('rejects when the typed confirmation name does not match the event name', async () => {
    const mock = buildActionSupabaseMock({
      eventRow: { id: 'evt-1', name: 'Sharma Wedding' },
    })
    createClientMock.mockResolvedValue(mock)

    const res = await deleteEvent('evt-1', 'Wrong Name')
    expect(res).toEqual({
      ok: false,
      error: 'That does not match. Type the event name exactly: Sharma Wedding',
    })
    expect(mock.rpc).not.toHaveBeenCalled()
  })

  it('returns an admin-only error when the database RPC refuses with 42501', async () => {
    const mock = buildActionSupabaseMock({
      eventRow: { id: 'evt-1', name: 'Sharma Wedding' },
      rpcError: { code: '42501', message: 'Only an admin can delete an event.' },
    })
    createClientMock.mockResolvedValue(mock)

    const res = await deleteEvent('evt-1', '  sharma wedding  ')
    expect(mock.rpc).toHaveBeenCalledWith('delete_event', { p_event_id: 'evt-1' })
    expect(res).toEqual({ ok: false, error: 'Only an admin can delete an event.' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('calls public.delete_event and revalidates layout when confirmed by an admin', async () => {
    const mock = buildActionSupabaseMock({
      eventRow: { id: 'evt-1', name: 'Sharma Wedding' },
      rpcData: { deleted: true, id: 'evt-1', code: 'SHARMA26', name: 'Sharma Wedding' },
    })
    createClientMock.mockResolvedValue(mock)

    const res = await deleteEvent('evt-1', 'Sharma Wedding')
    expect(mock.rpc).toHaveBeenCalledWith('delete_event', { p_event_id: 'evt-1' })
    expect(res).toEqual({ ok: true })
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })
})

const hasDB =
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

describe.runIf(hasDB)('delete_event RPC — DB-backed', () => {
  test('refuses non-admin callers and deletes a populated event cleanly for admin/service role', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!

    const sf = createClient(url, serviceKey, { auth: { persistSession: false } })
    const anon = createClient(url, anonKey, { auth: { persistSession: false } })

    const code = `DEL${Date.now().toString(36).toUpperCase().slice(-6)}`
    const { data: createdEvent, error: createErr } = await sf
      .from('events')
      .insert({
        name: `Delete Test ${code}`,
        code,
        starts_on: '2026-12-01',
      })
      .select('id, code, name')
      .single()

    if (createErr) throw createErr
    const eventId = createdEvent.id

    try {
      // Populate tables guarded by BEFORE DELETE triggers and ON DELETE RESTRICT FKs.
      const { data: staffRow, error: staffErr } = await sf
        .from('staff_members')
        .insert({ event_id: eventId, full_name: 'Test Coordinator' })
        .select('id')
        .single()
      if (staffErr) throw staffErr

      const { data: groupRow, error: groupErr } = await sf
        .from('guest_groups')
        .insert({
          event_id: eventId,
          head_name: 'Test Family',
          primary_mobile: '9876543210',
          created_by_staff: staffRow.id,
        })
        .select('id')
        .single()
      if (groupErr) throw groupErr

      const { error: guestErr } = await sf.from('guests').insert({
        event_id: eventId,
        group_id: groupRow.id,
        full_name: 'Test Family Head',
        is_head: true,
      })
      if (guestErr) throw guestErr

      const { error: callErr } = await sf.from('call_attempts').insert({
        event_id: eventId,
        group_id: groupRow.id,
        dialed_number: '9876543210',
        outcome: 'connected',
        caller_id_staff: staffRow.id,
      })
      if (callErr) throw callErr

      const { data: delivRow, error: delivErr } = await sf
        .from('deliverables')
        .insert({
          event_id: eventId,
          group_id: groupRow.id,
          kind: 'hamper',
          item_name: 'Welcome Hamper',
        })
        .select('id')
        .single()
      if (delivErr) throw delivErr

      const { error: proofErr } = await sf.from('delivery_proofs').insert({
        event_id: eventId,
        deliverable_id: delivRow.id,
        storage_bucket: 'r2:eventflow-delivery-proofs',
        storage_path: `${eventId}/${randomUUID()}.jpg`,
        captured_by_staff: staffRow.id,
      })
      if (proofErr) throw proofErr

      const { error: lockErr } = await sf.from('event_section_locks').insert({
        event_id: eventId,
        section: 'hamper',
      })
      if (lockErr) throw lockErr

      // 1. Direct row-level deletes remain blocked even for service_role.
      const { error: directProofDelErr } = await sf
        .from('delivery_proofs')
        .delete()
        .eq('event_id', eventId)
      expect(directProofDelErr?.code).toBe('42501')

      // 2. Calling delete_event without admin credentials is refused.
      const { error: anonRpcErr } = await anon.rpc('delete_event', {
        p_event_id: eventId,
      })
      expect(anonRpcErr).toBeTruthy()

      // 3. Whole-event delete_event removes the event and every child row.
      const { data: deleted, error: deleteErr } = await sf.rpc('delete_event', {
        p_event_id: eventId,
      })
      expect(deleteErr).toBeNull()
      expect(deleted).toMatchObject({ deleted: true, id: eventId, code })

      const { data: leftoverEvent } = await sf
        .from('events')
        .select('id')
        .eq('id', eventId)
        .maybeSingle()
      expect(leftoverEvent).toBeNull()
    } finally {
      // Ensure cleanup if an assertion fails mid-test.
      await sf.rpc('delete_event', { p_event_id: eventId })
    }
  })
})
