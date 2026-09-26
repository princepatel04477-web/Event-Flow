'use server'

import { revalidatePath } from 'next/cache'

import { friendlyDbError } from '@/lib/errors'
import type { LockableSection } from '@/lib/section-locks'
import { createClient } from '@/lib/supabase/server'

/**
 * Per-event section locks (A8).
 *
 * Reads are open to any staff session (`event_section_locks_sel` is
 * `app.is_staff(event_id)`) so the field team can show the "Locked by admin"
 * banner; writes are admin-only at the database
 * (`event_section_locks_ins/upd/del` are `app.is_admin()`). There is no
 * permission check in TypeScript on purpose — the database is the fence, and a
 * non-admin write comes back as 42501 and is reported as such.
 *
 * The table is not in `database.types.ts` (generated), so each call narrows the
 * client to the exact shape it uses rather than hand-editing a generated file.
 */

export type SectionLockState = Record<LockableSection, boolean>

export type SectionLockResult = { ok: true } | { ok: false; error: string }

/** Every section starts unlocked, and an unreadable table reads as unlocked. */
function emptyLocks(): SectionLockState {
  return { rsvp: false, hospitality: false, hamper: false, logistics: false }
}

type LockReadClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => Promise<{ data: Array<{ section: string }> | null }>
    }
  }
}

type LockWriteClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<{ error: DbError }>
    delete: () => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => Promise<{ error: DbError }>
      }
    }
  }
}

type DbError = { code?: string | null; message?: string | null } | null

export async function readSectionLocks(eventId: string): Promise<SectionLockState> {
  const state = emptyLocks()
  try {
    const supabase = await createClient()
    const { data } = await (supabase as unknown as LockReadClient)
      .from('event_section_locks')
      .select('section')
      .eq('event_id', eventId)

    for (const row of data ?? []) {
      if (row.section in state) state[row.section as LockableSection] = true
    }
  } catch {
    // A read failure is not an error the field team can act on. Report
    // unlocked here; the DATABASE still refuses a write to a locked section,
    // so failing open on the banner cannot fail open on the write.
  }
  return state
}

/** Is this one section locked? Thin wrapper for a server layout. */
export async function isSectionLocked(
  eventId: string,
  section: LockableSection,
): Promise<boolean> {
  const locks = await readSectionLocks(eventId)
  return locks[section]
}

export async function setSectionLock(
  eventId: string,
  section: LockableSection,
  locked: boolean,
): Promise<SectionLockResult> {
  const supabase = await createClient()
  const db = supabase as unknown as LockWriteClient

  if (locked) {
    const {
      data: { user },
    } = await db.auth.getUser()
    const { error } = await db
      .from('event_section_locks')
      .upsert(
        { event_id: eventId, section, locked_by: user?.id ?? null, locked_at: new Date().toISOString() },
        { onConflict: 'event_id,section' },
      )
    if (error) return { ok: false, error: lockError(error) }
  } else {
    const { error } = await db
      .from('event_section_locks')
      .delete()
      .eq('event_id', eventId)
      .eq('section', section)
    if (error) return { ok: false, error: lockError(error) }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}

function lockError(error: DbError): string {
  if (error?.code === '42501') return 'Only an admin can lock a section.'
  return friendlyDbError(error)
}
