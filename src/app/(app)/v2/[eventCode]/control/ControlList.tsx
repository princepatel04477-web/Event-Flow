'use client'

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'

import { ChevronRightIcon, SearchIcon } from '@/components/icons'

export interface ControlRow {
  href: string
  label: string
  value?: string
  icon: ReactNode
  /** Extra words the filter matches ("cod" finds Access codes, "whatsapp" finds Send). */
  keywords: string
}

export interface ControlGroup {
  title: string
  rows: ControlRow[]
}

/**
 * The grouped list on Control, plus the filter box above it.
 *
 * Filtering is local and synchronous — twelve rows, no network — so the list
 * answers on the keystroke (T1). Groups with no matching rows disappear rather
 * than rendering an empty card.
 */
export function ControlList({ groups }: { groups: ControlGroup[] }) {
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => `${r.label} ${r.keywords} ${g.title}`.toLowerCase().includes(q)),
      }))
      .filter((g) => g.rows.length > 0)
  }, [groups, query])

  return (
    <div className="flex flex-col gap-6">
      <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-rule-strong bg-surface px-4 focus-within:border-brand">
        <SearchIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden />
        <span className="sr-only">Find a tool</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a tool — codes, staff, send…"
          className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-subtle focus:outline-none"
        />
      </label>

      {visible.length === 0 ? (
        <p className="px-1 text-sm text-muted">Nothing called “{query.trim()}”. Try “codes” or “send”.</p>
      ) : null}

      {visible.map((group) => (
        <section key={group.title} className="flex flex-col gap-2">
          <h2 className="eyebrow px-1">{group.title}</h2>
          <ul className="overflow-hidden rounded-2xl border border-rule bg-surface">
            {group.rows.map((row) => (
              <li key={`${row.href}:${row.label}`} className="border-b border-rule last:border-b-0">
                <Link
                  href={row.href}
                  className="tap flex min-h-14 items-center gap-3 px-4 py-2 transition-colors duration-press ease-ledger active:bg-surface-2"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand">
                    {row.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">{row.label}</span>
                  {row.value ? (
                    <span className="shrink-0 text-sm text-muted tabular-nums">{row.value}</span>
                  ) : null}
                  <ChevronRightIcon className="h-5 w-5 shrink-0 text-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default ControlList
