import { redirect } from 'next/navigation'

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * The Rooms section's root address.
 *
 * WHY THIS PAGE EXISTS. The v3 bottom bar's "Rooms" tab points at the
 * section root — `v3Href` in `src/lib/sections/v3.ts` builds
 * `/{event}/hospitality` because `SECTIONS.hospitality` carries no `path` —
 * and nothing served that path. The tab rendered perfectly and 404'd on tap,
 * which is one of five tabs dead and, for a hospitality runner, no route into
 * their own job. See `docs/BUGS.md` B1.
 *
 * WHY A REDIRECT AND NOT A LANDING PAGE. SPEC-V3 §4 gives Rooms one screen
 * with a By room / Waiting switch inside it, so a root that rendered a chooser
 * would be a third screen for a job that has two. The same shape as
 * `logistics/page.tsx`, whose Travel tab has the same problem.
 *
 * NO GUARD HERE, DELIBERATELY. The section layout above this file is the gate
 * in both trees (`(staff)` requires `hospitality`; the v2 tree allows the
 * hospitality/hamper union its hamper run needs), and gating a redirect adds a
 * second place for the audience to be wrong.
 */
export default async function HospitalityRootPage({ params }: PageProps) {
  const { eventCode } = await params
  redirect(`/${eventCode}/hospitality/rooms`)
}
