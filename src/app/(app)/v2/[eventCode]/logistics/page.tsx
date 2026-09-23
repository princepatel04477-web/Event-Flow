import { redirect } from 'next/navigation'

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * The Travel tab's address, which is the arrivals board.
 *
 * WHY A REDIRECT. SPEC-V3 §4 gives Travel one screen with an Arrivals /
 * Departures switch inside it. The v3 bar, however, points this tab at the
 * section root (`/{event}/logistics`) — see `v3Href` in `src/lib/sections/v3.ts`
 * — and a root that rendered a "choose your direction" landing page would be a
 * third screen for a job that has two.
 *
 * So the root IS arrivals, and the other direction is one tap away in the
 * switch at the top of the board. A runner who taps Travel lands on the board
 * they almost always want; a manager who wanted departures taps once.
 *
 * NO GUARD HERE, DELIBERATELY. The destination runs `requireTravelScreen`, and
 * gating a redirect adds a second place for the audience of this section to be
 * wrong. The redirect sends anyone the destination would bounce straight there
 * with the same `?denied=section` marker the legacy layout produced.
 */
export default async function LogisticsRootPage({ params }: PageProps) {
  const { eventCode } = await params
  redirect(`/${eventCode}/logistics/arrivals`)
}
