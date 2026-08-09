import { InboxIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { StickyHeader } from '@/components/ui/StickyHeader'

/**
 * The outermost 404 — an unknown URL, and the important case: an event code
 * the viewer cannot reach.
 *
 * The event layout calls `notFound()` when `resolveEventByCode` returns null,
 * and a boundary cannot catch a throw from the layout it lives under, so that
 * lands here rather than on the event 404. It renders outside every shell,
 * hence its own header.
 *
 * The wording deliberately does not distinguish "no such event" from "you are
 * not on it". RLS makes those indistinguishable on purpose — saying which
 * would confirm to a stranger that a given event code exists.
 */
export default function RootNotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <StickyHeader title="Nuvent" subtitle="Page not found" />
      <main className="mx-auto w-full max-w-[480px] flex-1 px-4 py-8">
        <EmptyState
          icon={<InboxIcon className="h-7 w-7" />}
          title="We could not find that page"
          description="Either the link is wrong, or this event is not one your account is on. Go back to your events and pick from there."
          action={
            <LinkButton href="/" fullWidth>
              Back to my events
            </LinkButton>
          }
        />
      </main>
    </div>
  )
}
