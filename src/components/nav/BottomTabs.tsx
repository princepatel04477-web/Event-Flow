'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import {
  ClipboardCheckIcon,
  GridIcon,
  PhoneIcon,
  UploadIcon,
} from '@/components/icons'

type Tab = {
  /** Path segment after /{eventCode}. Empty string is the dashboard. */
  segment: string
  label: string
  icon: ReactNode
}

const TABS: Tab[] = [
  { segment: 'queue', label: 'Queue', icon: <PhoneIcon className="h-6 w-6" /> },
  { segment: 'import', label: 'Import', icon: <UploadIcon className="h-6 w-6" /> },
  {
    segment: 'review',
    label: 'Review',
    icon: <ClipboardCheckIcon className="h-6 w-6" />,
  },
  { segment: '', label: 'Dashboard', icon: <GridIcon className="h-6 w-6" /> },
]

export interface BottomTabsProps {
  /** Canonical event code from the database, not the raw URL segment. */
  eventCode: string
}

/**
 * Thumb-reach navigation. Fixed to the bottom because that is where a hand
 * already is when you are holding a phone and a clipboard.
 */
export function BottomTabs({ eventCode }: BottomTabsProps) {
  const pathname = usePathname()

  // The event code in the URL may differ in case from the canonical one, so
  // match on position rather than on the full path.
  const segments = pathname.split('/').filter(Boolean)
  const current = segments.length > 1 ? segments[1] : ''

  return (
    <nav
      aria-label="Event sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-safe px-safe"
    >
      <ul className="mx-auto grid w-full max-w-2xl grid-cols-4">
        {TABS.map((tab) => {
          const href = tab.segment ? `/${eventCode}/${tab.segment}` : `/${eventCode}`
          const active = current === tab.segment

          return (
            <li key={tab.label}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'tap flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-medium',
                  active ? 'text-brand' : 'text-muted hover:text-fg',
                )}
              >
                {tab.icon}
                <span className="leading-none">{tab.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default BottomTabs
