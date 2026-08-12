import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface PageTitleProps {
  /** One or two words. Uppercased and tracked by CSS, not by the caller. */
  children: ReactNode
  /**
   * The screen's headline figure or sort order — "143 / 168", "PRIORITY ↓".
   * Rendered in mono so it lines up with the figures below it.
   */
  right?: ReactNode
  /** A sentence under the title explaining what the screen is for. */
  note?: ReactNode
  className?: string
}

/**
 * The screen title, in the display serif.
 *
 * Cormorant Garamond appears in exactly three places in this app: here, on
 * the couple's names, and on the seal. Restricting it is what keeps it
 * meaning "you are somewhere" rather than being decoration — everything a
 * caller actually reads and acts on is set in the sans face.
 *
 * The tracked uppercase treatment is deliberate at this size: Cormorant is
 * a high-contrast old-style face with thin hairlines, and set tight at 20px
 * on a night ground on a cheap LCD the thin strokes disappear. Spacing the
 * letters gives each one room to survive.
 */
export function PageTitle({ children, right, note, className }: PageTitleProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 className="font-display text-xl leading-none font-medium tracking-[0.14em] text-ink uppercase">
          {children}
        </h2>
        {right ? (
          <span className="figure shrink-0 text-sm text-muted">{right}</span>
        ) : null}
      </div>
      {note ? <p className="text-sm leading-snug text-muted">{note}</p> : null}
    </div>
  )
}

export default PageTitle
