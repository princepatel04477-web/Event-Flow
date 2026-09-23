'use client'

import Link from 'next/link'

interface AdminCampaignsLinkProps {
  eventCode: string
  isAdmin?: boolean
}

export function AdminCampaignsLink({ eventCode, isAdmin }: AdminCampaignsLinkProps) {
  if (!isAdmin) return null

  return (
    <div className="flex justify-end pt-1">
      <Link
        href={`/${eventCode}/rsvp/campaigns`}
        className="text-xs font-medium text-muted underline hover:text-ink active:text-brand"
      >
        Auto-call rounds (admin)
      </Link>
    </div>
  )
}
