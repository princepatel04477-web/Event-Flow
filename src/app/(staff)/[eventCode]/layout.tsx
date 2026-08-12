import { EventLayoutClient } from './layout-client'

/**
 * The one event this APK is built for.
 *
 * A tenant slug cannot be enumerated at build time — there is no database
 * connection to ask, and listing them would leak other tenants into a bundle
 * anyone can unzip. So the build is pinned to a single event, supplied by
 * NEXT_PUBLIC_EVENT_CODE, and SHARMA26 is the fallback.
 *
 * The previous `return []` satisfied Next's "has generateStaticParams" check
 * while emitting zero pages, so out/ contained no event routes at all.
 */
export function generateStaticParams(): Array<{ eventCode: string }> {
  return [{ eventCode: process.env.NEXT_PUBLIC_EVENT_CODE ?? 'SHARMA26' }]
}

/**
 * Any eventCode outside the list above 404s instead of being rendered on
 * demand. There is no server to render on demand, so the honest answer for an
 * unbuilt tenant is "not here" rather than a blank shell.
 */
export const dynamicParams = false

type LayoutProps = {
  children: React.ReactNode
  params: Promise<{ eventCode: string }>
}

export default function EventLayout(props: LayoutProps) {
  return <EventLayoutClient {...props} />
}
