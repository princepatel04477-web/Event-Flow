import Link from 'next/link'

import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import type { AdminEventOption } from '@/lib/events/adminEvent'

/**
 * The "which wedding?" step for event-scoped admin screens.
 *
 * Rendered only when the code in `?event=` is missing or unknown, so the
 * common single-event case never sees it.
 */
export function EventPicker({
  events,
  basePath,
  title,
  description,
}: {
  events: AdminEventOption[]
  basePath: string
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-fg">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Create an event before setting up hotels and rooms."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={`${basePath}?event=${encodeURIComponent(event.code)}`}
                className="block"
              >
                <Card className="transition-colors hover:bg-surface-2 active:bg-surface-2">
                  <CardBody className="py-3">
                    <p className="font-semibold text-fg">{event.name}</p>
                    <p className="text-sm text-muted">{event.code}</p>
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default EventPicker
