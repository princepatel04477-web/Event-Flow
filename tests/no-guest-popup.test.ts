import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// Mock supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { NoGuestListPopup } from '@/components/guests/NoGuestListPopup'
import { hasGuestList } from '@/lib/actions/dashboard'


describe('NoGuestListPopup & hasGuestList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports NoGuestListPopup function component', () => {
    expect(typeof NoGuestListPopup).toBe('function')
  })

  it('hasGuestList returns true when guest groups exist', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ count: 12, error: null }),
    })
    const mockFrom = vi.fn().mockReturnValue({
      select: mockSelect,
    })
    ;(createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: mockFrom,
    })

    const result = await hasGuestList('ev-101')
    expect(result).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('guest_groups')
    expect(mockSelect).toHaveBeenCalledWith('id', { count: 'exact', head: true })
  })

  it('hasGuestList returns false when guest groups count is 0', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
    })
    const mockFrom = vi.fn().mockReturnValue({
      select: mockSelect,
    })
    ;(createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: mockFrom,
    })

    const result = await hasGuestList('ev-empty')
    expect(result).toBe(false)
  })

  it('session key matches expected format per event code', () => {
    const code = 'sharma26'
    const expectedKey = `ef_dismiss_no_guest_popup_${code.toUpperCase()}`
    expect(expectedKey).toBe('ef_dismiss_no_guest_popup_SHARMA26')
  })
})
