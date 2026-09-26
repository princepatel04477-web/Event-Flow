import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `getEventAccess` and the `is_active` gate on its member branches.
 *
 * WHY THIS EXISTS. The database fences a deactivated member out of every base
 * table: `app.is_member()` routes every non-admin through `app.is_admin()`,
 * which requires `profiles.is_active`. The app's answer has to agree, or a
 * screen says "you are event_team" while handing back zero rows — the
 * confident lie this function exists to prevent.
 *
 * It also has to agree with `public.route_context()` (S2), or the fast path and
 * the fallback differ for one user depending only on whether that migration is
 * live. Both were changed together; this locks the function half.
 *
 * `server-only` throws outside a React Server Component graph, so it is
 * neutralised as the other server-module tests do.
 */
vi.mock('server-only', () => ({}))

const profileSingle = vi.fn()
const memberSingle = vi.fn()
const getClaims = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: table === 'profiles' ? profileSingle : memberSingle,
          // event_members reads chain a second .eq() before .maybeSingle().
          eq: () => ({ maybeSingle: memberSingle }),
        }),
      }),
    }),
  }),
}))

/** No code-auth session: these tests are the GoTrue (admin) path. */
vi.mock('@/lib/auth/server', () => ({
  getSessionClaims: async () => null,
}))

const { getEventAccess } = await import('@/lib/supabase/queries')

beforeEach(() => {
  profileSingle.mockReset()
  memberSingle.mockReset()
  getClaims.mockReset()
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } } })
})

describe('getEventAccess requires an active profile', () => {
  it('answers none for a DEACTIVATED member, even though the row exists', async () => {
    profileSingle.mockResolvedValue({ data: { global_role: 'member', is_active: false } })
    memberSingle.mockResolvedValue({ data: { role: 'event_team' } })

    await expect(getEventAccess('event-1')).resolves.toBe('none')
  })

  it('answers none for a DEACTIVATED client', async () => {
    profileSingle.mockResolvedValue({ data: { global_role: 'member', is_active: false } })
    memberSingle.mockResolvedValue({ data: { role: 'client' } })

    await expect(getEventAccess('event-2')).resolves.toBe('none')
  })

  it('still answers event_team for an ACTIVE member', async () => {
    profileSingle.mockResolvedValue({ data: { global_role: 'member', is_active: true } })
    memberSingle.mockResolvedValue({ data: { role: 'event_team' } })

    await expect(getEventAccess('event-3')).resolves.toBe('event_team')
  })

  it('answers none for a deactivated admin', async () => {
    profileSingle.mockResolvedValue({ data: { global_role: 'admin', is_active: false } })
    memberSingle.mockResolvedValue({ data: null })

    await expect(getEventAccess('event-4')).resolves.toBe('none')
  })

  it('answers admin for an active admin', async () => {
    profileSingle.mockResolvedValue({ data: { global_role: 'admin', is_active: true } })
    memberSingle.mockResolvedValue({ data: null })

    await expect(getEventAccess('event-5')).resolves.toBe('admin')
  })
})
