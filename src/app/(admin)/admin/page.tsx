import { redirect } from 'next/navigation'

/**
 * `/admin` has no screen of its own — it exists so the segment resolves.
 *
 * `admin` is a static segment and Next matches static before dynamic, so it
 * shadows `/[eventCode]` whether or not a page lives here. Without this file
 * a typed `/admin` 404s instead of falling through to the event route, which
 * reads as "the admin area is broken". One redirect is cheaper than that
 * confusion. The (admin) layout still runs, so a non-admin is bounced to the
 * front door before this is reached.
 */
export default function AdminIndexPage() {
  redirect('/admin/events')
}
