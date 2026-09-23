import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface AdminPageTitleProps {
  /** The screen's plain name. "Staff", "Access codes", "Events". */
  children: ReactNode
  /**
   * The small muted line ABOVE the title — the same role as `ScreenHeader`'s
   * `context` on the staff screens: a hotel name, a count, an event code.
   * One line, no capitals shouting.
   */
  context?: ReactNode
  /** Right-hand controls (a count, a button) pinned to the title's baseline. */
  actions?: ReactNode
  className?: string
}

/**
 * The admin area's screen title.
 *
 * `ScreenHeader` is the v3 title treatment, but it is the *shell's* header —
 * the admin shell already renders one ("Admin") and every admin screen sits
 * under it, so a page cannot render a second `ScreenHeader` without stacking
 * two sticky bars. This renders the same type decision (small muted context
 * over a 30px Bricolage title, `tracking-tight`) as an in-flow page heading
 * instead of a sticky bar, which is what an admin page — a dense, desktop-ish
 * surface with its own sidebar — actually wants.
 *
 * It replaces `PageTitle`, whose uppercase tracked display treatment is the
 * pre-v3 "eyebrow capitals" look that §3 of the spec deletes.
 */
export function AdminPageTitle({
  children,
  context,
  actions,
  className,
}: AdminPageTitleProps) {
  return (
    <div className={cn('flex items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {context ? (
          <p className="truncate text-sm leading-tight text-muted">{context}</p>
        ) : null}
        <h1 className="truncate font-display text-[1.875rem] leading-[1.15] font-semibold tracking-tight text-ink">
          {children}
        </h1>
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

export default AdminPageTitle
