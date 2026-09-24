'use client'

import { useSearchParams } from 'next/navigation'

import { ShieldAlertIcon } from '@/components/icons'
import { deniedMessage } from '@/lib/sections/denied'

/**
 * "That screen is for another team" — the note a refused tap leaves behind.
 *
 * MOUNTED BY THE SHELL, so it renders wherever the bounce LANDED. It used to be
 * rendered only by Today, but `requireSection` sends a denied viewer to their own
 * department home (Rooms, Arrivals, Hampers), and `?denied=section` in a URL
 * nothing reads is a silent bounce: the tap looks like a dead link on the one
 * navigation a runner has (`docs/BUGS.md` M3, M7).
 *
 * A client component because the marker is a query parameter, and a server
 * layout cannot see one. It reads the URL instead of taking a prop, so a screen
 * added later inherits the note for free.
 */
export function DeniedNote() {
  const searchParams = useSearchParams()
  const note = deniedMessage(searchParams.get('denied'))

  if (!note) return null

  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-rule-strong bg-surface px-3.5 py-3">
      <ShieldAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
      <p role="status" className="text-sm leading-snug text-ink">
        {note}
      </p>
    </div>
  )
}

export default DeniedNote
