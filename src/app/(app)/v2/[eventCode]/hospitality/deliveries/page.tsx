import { redirect } from 'next/navigation'

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export const metadata = {
  title: 'Hampers',
}

/**
 * The v2-era address for the hamper run, now a door to the Hampers tab.
 *
 * WHY A REDIRECT AND NOT A SECOND LIST. `HamperRun` used to be mounted here and
 * at `/{event}/hamper` was a re-export of the v1 `DeliveryList` — two screens
 * for one job, one of them the oldest build in the repo, and the tab named for
 * the job pointed at the old one. The fix is one run screen at one address, so
 * this route keeps working (bookmarks, `departmentHomePath` for the hamper
 * department, the Today card's `AttentionPanel` link) without a second copy of
 * the list to keep in step.
 *
 * NO GUARD HERE, DELIBERATELY. The destination runs `requireHamperScreen`,
 * which is the union of the hospitality and hamper departments; running a
 * narrower gate on a redirect would turn a link that lands correctly into a
 * bounce before the destination ever got to decide.
 */
export default async function HampersRedirectPage({ params }: PageProps) {
  const { eventCode } = await params
  redirect(`/${eventCode}/hamper`)
}
