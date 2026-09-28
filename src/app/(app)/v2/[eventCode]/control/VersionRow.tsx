'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * The quiet version line at the foot of Control, and the only door to the
 * developer tools.
 *
 * Harvest debug used to sit in the admin's main nav beside Settings, where a
 * non-technical organiser tapped into it. It now takes a deliberate 700ms press
 * on this line (pointer events, no library), which a developer knows to do and
 * an organiser never does by accident.
 */
export function VersionRow() {
  const router = useRouter()
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
        timer.current = window.setTimeout(() => router.push('/admin/harvest-debug'), 700)
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
