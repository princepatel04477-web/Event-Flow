import type { ReactNode } from 'react'

/**
 * Shell for every signed-in staff screen.
 *
 * Deliberately thin: the event-scoped layout below it owns the header and the
 * tab bar, because everything it needs is keyed by [eventCode].
 */
export default function StaffLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-paper">{children}</div>
}
