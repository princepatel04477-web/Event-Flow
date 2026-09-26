import { describe, expect, test } from 'vitest'

/**
 * Section locks are enforced in the DATABASE (A8).
 *
 * WHY THIS FILE EXISTS. A lock that only hides controls in the UI is not a
 * lock: the write still reaches the database through any other client. The
 * enforcement is a BEFORE trigger (`app.enforce_section_lock`), and a trigger
 * fires for the service role too — service role bypasses RLS, not triggers —
 * so this test can prove the refusal with the same service client the other
 * DB-backed suites use.
 *
 * `app.is_admin()` is false without a signed-in admin (`auth.uid()` is null for
 * the service role), which is exactly the "not the office" case the trigger is
 * meant to refuse.
 *
 * DB-backed tests require `E2E_EVENT_ID`, `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY` in `.env.test`, and are SKIPPED otherwise. They
 * also skip when migration 20260925160000 has not been applied to the target
 * project — the migrations in this branch are deliberately written, not
 * applied, so on an un-migrated database this reports why rather than failing.
 */

const hasDB = !!process.env.SUPABASE_SERVICE_ROLE_KEY

describe.runIf(hasDB)('section locks — DB-backed', () => {
  test('a write to a locked section is refused', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const sf = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    })

    const eventId = process.env.E2E_EVENT_ID
    if (!eventId) {
      console.warn('Skipping: set E2E_EVENT_ID')
      return
    }

    // Probe for the migration. An un-migrated project has no lock table.
    const probe = await sf.from('event_section_locks').select('section').limit(1)
    if (probe.error) {
      console.warn(
        'Skipping: apply supabase/migrations/20260925160000_event_section_locks.sql to run this.',
      )
      return
    }

    const { data: groups } = await sf
      .from('guest_groups')
      .select('id, rsvp_status')
      .eq('event_id', eventId)
      .limit(1)

    const group = groups?.[0]
    if (!group) {
      console.warn('Skipping: no guest_groups on E2E_EVENT_ID to write to.')
      return
    }

    await sf.from('event_section_locks').upsert(
      { event_id: eventId, section: 'rsvp' },
      { onConflict: 'event_id,section' },
    )

    try {
      const { error } = await sf
        .from('guest_groups')
        .update({ rsvp_status: group.rsvp_status })
        .eq('id', group.id)

      // 42501 is insufficient_privilege — the trigger's errcode.
      expect(error?.code).toBe('42501')
    } finally {
      await sf.from('event_section_locks').delete().eq('event_id', eventId).eq('section', 'rsvp')
    }
  })
})
