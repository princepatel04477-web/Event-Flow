import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'RSVP',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export default async function RsvpIndexPage({ params }: PageProps) {
  const { eventCode } = await params
  redirect(`/${eventCode}/rsvp/queue`)
}