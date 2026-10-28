'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * The quiet version line at the foot of Control, and the only door to the
 * developer tools.
 *
 * Harvest debug used to sit in the admin's main nav beside Settings, where a
 * non-technical organiser tapped into it. It now takes a deliberate 700ms press
 * on this line (pointer events, no library), which a developer knows to do and
 * an organiser never does by accident.
 *
 * The press now opens the CAPTURE TEST rather than `/admin/harvest-debug`.
 * Both are developer tools, but only one of them a staff member can open: the
 * harvest debug screen is under `(admin)`, so a code-auth team session — every
 * phone on the calling floor — gets nothing at all (CLAUDE.md §12). Since the
 * question the tool answers is "does capture work on THIS handset", a door
 * only the developer's own login can open tests the one phone nobody doubted.
 * An admin can still reach harvest debug by URL.
 */
export function VersionRow() {
  const router = useRouter()
  const params = useParams<{ eventCode: string }>()
  const [commit, setCommit] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/version')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { commit?: string | null } | null) => {
        if (alive) setCommit(body?.commit ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  return (
    <p
      onPointerDown={() => {
        cancel()
        timer.current = window.setTimeout(
          () => router.push(`/${params.eventCode}/control/capture-test`),
          700,
        )
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className="select-none py-4 text-center text-xs text-subtle"
    >
      EventFlow{commit ? ` · build ${commit.slice(0, 7)}` : ''}
    </p>
  )
}

export default VersionRow
