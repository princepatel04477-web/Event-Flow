import { redirect } from 'next/navigation'

type PageProps = { params: Promise<{ eventCode: string }> }

/**
 * `/{event}/families` — the directory address from the UI4 route map (S3).
 * Until the guest directory moves here, it is served where it lives, so the
 * address one level up from a family page is never a 404.
 */
export default async function FamiliesPage({ params }: PageProps) {
  const { eventCode } = await params
  redirect(`/${eventCode}/guests`)
}
