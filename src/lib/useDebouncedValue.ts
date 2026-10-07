'use client'

import { useEffect, useState } from 'react'

/**
 * A value that follows `value` after `delay` ms of stillness.
 *
 * The app already debounced its search inputs in three places by copy-pasting
 * the same ref + setTimeout effect (`StaffGuestDirectory` 250ms; the two guest
 * lists 300ms). This is that behaviour in one place, so the two inputs that were
 * still re-deriving whole lists on EVERY keystroke can share it rather than
 * growing a fourth copy.
 *
 * The DEBOUNCED value is what the expensive derivation reads; the raw `value`
 * keeps driving the input, so typing stays instant while the filter/sort runs at
 * most once per `delay`.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

export default useDebouncedValue
