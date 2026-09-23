import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireSection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'

export const metadata: Metadata = {
  title: 'Production',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Setup (Production) under the v3 shell.
 *
 * ── Why this is no longer a re-export ─────────────────────────────────────
 * It was `export { default } from '@/app/(staff)/[eventCode]/production/page'`,
 * which served the legacy placeholder — an `EmptyState` sized and armed for the
 * v1 shell. The data on this screen is one sentence ("not built yet"), so
 * "restyle, not redesign" (SPEC-V3 §4) means exactly one thing here: render
 * that sentence on the v3 ground rather than inheriting v1's chrome.
 *
 * ── What is deliberately identical ────────────────────────────────────────
 * The GUARD and the FETCH are copied from the legacy page line for line, not
 * re-invented: `resolveEventByCode` → `notFound()` → `requireSection(...,
 * 'production')`, in that order, with the same arguments. The section layout
 * shim above this page (`production/layout.tsx`) still re-exports the legacy
 * layout and therefore still runs the same `requireSection`, which is the
 * duplication v1 already carries. Neither the fetch nor the gate changed; only
 * the returned markup did.
 *
 * ── Two things this screen deliberately does NOT have ─────────────────────
 * There is no `<h1>`: the shell's `AppHeader` already titles this route
 * ("Setup", via `v3ScreenTitle`), and the components README is explicit that a
 * screen inside the shell must not render a second header.
 *
 * There is no action button. The legacy copy ended "For now, use Home for
 * event-day numbers", and a "Go to Today" link was the obvious v3 translation
 * of it — but it is wrong for the viewer most likely to be standing here. A
 * `production` runner is a single-screen department, so Today redirects them
 * straight back to this page (`v2DepartmentHome`), and the link would read as
 * a dead button. The honest screen is the sentence and nothing else.
 */
export default async function V2ProductionPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireSection(event.id, event.code, 'production')

  return (
    <section className="rounded-2xl border border-rule bg-surface p-5">
      {/* Not "Production prep" — the shell's header already says "Setup" for
          this route, and a body heading repeating the header's name is the
          duplicate title the v3 rules delete. This heading carries the STATE
          instead, which is the one thing the header cannot say. */}
      <h2 className="font-display text-2xl leading-tight font-semibold text-ink">
        Nothing to set up yet
      </h2>
      <p className="mt-2 text-base leading-snug text-muted">
        Your team’s setup checklist and run-of-show tools will live here.
      </p>
    </section>
  )
}
