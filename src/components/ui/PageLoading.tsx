import { Spinner } from './Spinner'

export interface PageLoadingProps {
  /** Shown under the spinner. Keep it to a few words. */
  label?: string
}

/**
 * The body of every `loading.tsx`.
 *
 * Every event screen is a dynamic server component doing two to four Supabase
 * round trips before it emits any markup. On venue Wi-Fi that is seconds of a
 * frozen previous screen, and a staff member who gets no acknowledgement taps
 * again — firing a second navigation. A Suspense fallback is the whole fix.
 *
 * `min-h-[50vh]` rather than a fixed height so the spinner sits near where the
 * content will land instead of jumping when it arrives.
 */
export function PageLoading({ label = 'Loading' }: PageLoadingProps) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <Spinner size="lg" label={label} />
      <p className="text-sm text-muted">{label}…</p>
    </div>
  )
}

export default PageLoading
