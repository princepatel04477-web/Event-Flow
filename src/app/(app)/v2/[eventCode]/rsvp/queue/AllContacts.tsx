'use client'

import { useMemo, useState } from 'react'

import type { QueueRow } from './types'

const STATUS: Record<string, { label: string; dot: string }> = {
  confirmed: { label: 'Coming', dot: 'bg-ledger-green' },
  declined: { label: 'Not coming', dot: 'bg-ledger-red' },
  tentative: { label: 'Maybe', dot: 'bg-ledger-amber' },
  callback: { label: 'Call back', dot: 'bg-ledger-amber' },
  unreachable: { label: 'No answer', dot: 'bg-ledger-amber' },
  attempted: { label: 'Tried once', dot: 'bg-ledger-amber' },
}

const PAGE = 50

interface AllContactsProps {
  rows: readonly QueueRow[]
  currentGroupId: string | null
  onSelectFamily: (groupId: string) => void
}

/**
 * Every family on the event, always on screen under the call card: name,
 * number, where their RSVP stands, and a one-tap dial. Searchable by name or
 * phone. Tapping a name makes that family the current one on the card above.
 */
export function AllContacts({ rows, currentGroupId, onSelectFamily }: AllContactsProps) {
  const [term, setTerm] = useState('')
  const [shown, setShown] = useState(PAGE)

  const list = useMemo(() => {
    const q = term.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    const withId = rows.filter((r) => r.group_id !== null)
    const matched = q
      ? withId.filter(
          (r) =>
            (r.head_name ?? '').toLowerCase().includes(q) ||
            (digits.length >= 3 && (r.primary_mobile ?? '').replace(/\D/g, '').includes(digits)),
        )
      : withId
    return [...matched].sort((a, b) => (a.head_name ?? '').localeCompare(b.head_name ?? ''))
  }, [rows, term])

  return (
    <section className="flex flex-col gap-2" aria-label="All contacts">
      <h2 className="eyebrow">All contacts · {list.length}</h2>
      <input
        type="search"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value)
          setShown(PAGE)
        }}
        placeholder="Search name or phone"
        className="h-12 w-full rounded-2xl border border-rule-strong bg-surface px-4 text-base text-ink placeholder:text-subtle focus:border-brand focus:outline-none"
      />
      {list.length === 0 ? (
        <p className="px-1 py-3 text-sm text-muted">No family matches that search.</p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-rule bg-surface">
          {list.slice(0, shown).map((r) => {
            const s = STATUS[r.rsvp_status ?? ''] ?? { label: 'Not called', dot: 'bg-subtle' }
            const isCurrent = r.group_id === currentGroupId
            const phone = r.primary_mobile?.trim() || null
            return (
              <li
                key={r.group_id as string}
                className={`flex items-center gap-3 border-b border-rule px-3.5 py-2.5 last:border-b-0 ${isCurrent ? 'bg-brand-tint' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => onSelectFamily(r.group_id as string)}
                  className="tap flex min-h-11 min-w-0 flex-1 flex-col items-start text-left"
                >
                  <span className="w-full truncate text-[15px] font-medium text-ink">
                    {r.head_name?.trim() || 'Unnamed family'}
                  </span>
                  <span className="flex w-full items-center gap-1.5 truncate text-sm text-muted">
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                    <span className="truncate">
                      {s.label}
                      {phone ? ` · ${phone}` : ' · no number'}
                    </span>
                  </span>
                </button>
                {phone ? (
                  <a
                    href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                    className="tap inline-flex h-10 shrink-0 items-center rounded-full bg-ledger-green px-4 text-sm font-semibold text-white"
                    aria-label={`Call ${r.head_name ?? 'family'}`}
                  >
                    Call
                  </a>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {list.length > shown ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="tap min-h-11 text-center text-sm font-medium text-brand"
        >
          Show {Math.min(PAGE, list.length - shown)} more
        </button>
      ) : null}
    </section>
  )
}
