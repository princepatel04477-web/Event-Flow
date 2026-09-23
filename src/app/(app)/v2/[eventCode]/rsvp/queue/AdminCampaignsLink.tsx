'use client'

import Link from 'next/link'

interface AdminCampaignsLinkProps {
  eventCode: string
  isAdmin?: boolean
}

export function AdminCampaignsLink({ eventCode, isAdmin }: AdminCampaignsLinkProps) {
  if (!isAdmin) return null

  return (
    <Link
      href={`/${eventCode}/rsvp/campaigns`}
      className="tap inline-flex min-h-11 items-center px-2 text-sm font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
    >
      Auto-call rounds
    </Link>
  )
}
