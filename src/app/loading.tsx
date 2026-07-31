import { PageLoading } from '@/components/ui/PageLoading'

/**
 * The outermost fallback.
 *
 * The nested `loading.tsx` files cover each page's own data, but NOT the
 * layout above it — the event layout alone does `getViewer` +
 * `resolveEventByCode` + `getEventAccess` before it can draw the header, and
 * that work suspends here. Without this file the previous screen simply
 * freezes for the duration.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4">
      <PageLoading />
    </div>
  )
}
