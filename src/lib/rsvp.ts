/**
 * RSVP status vocabulary. The definitions live in `@/lib/status` — the one
 * source of truth for every status word and colour in the app. This module
 * re-exports the RSVP slice so existing call sites keep their short import
 * while the vocabulary cannot drift.
 *
 * See `@/lib/status` for the full vocabulary (RSVP, delivery, ledger, room).
 */

import type { BadgeTone } from '@/components/ui/Badge'
import {
  RSVP_STATUS_LABELS,
  RSVP_STATUS_OPTIONS,
  RSVP_STATUS_TONES,
  statusLabel,
  statusTone,
  type RsvpStatus,
  type StatusTone,
} from '@/lib/status'

export type { RsvpStatus }
export { RSVP_STATUS_LABELS, RSVP_STATUS_OPTIONS }

/**
 * The legacy tone names map onto the ledger tones. Kept so the existing
 * `Badge` component and call sites that pass `BadgeTone` keep working while
 * Q2 migrates them to `StatusPill`.
 */
export function rsvpStatusLabel(value: string | null | undefined): string {
  return statusLabel(value)
}

export function rsvpStatusTone(value: string | null | undefined): BadgeTone {
  return statusToneToBadgeTone(statusTone(value))
}

function statusToneToBadgeTone(tone: StatusTone): BadgeTone {
  switch (tone) {
    case 'done':
      return 'success'
    case 'attention':
      return 'danger'
    case 'active':
      return 'warning'
    case 'neutral':
      return 'neutral'
  }
}

export { RSVP_STATUS_TONES }
