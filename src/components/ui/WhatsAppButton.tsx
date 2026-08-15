'use client'

import { MessageCircleIcon } from '@/components/icons'
import { openExternalAppUrl } from '@/lib/native/navigation'
import { whatsappHref } from '@/lib/phone'
import { cn } from '@/lib/utils'

export interface WhatsAppButtonProps {
  /** The stored mobile, exactly as it sits in the row. Not pre-normalised. */
  mobile: string | null | undefined
  /** Whose number this is — read out by the accessible label. */
  name?: string | null
  className?: string
}

/**
 * A WhatsApp deep link, sat beside the call button.
 *
 * Two things it deliberately is not:
 *
 *  - **Not an integration.** It opens `wa.me` in whatever WhatsApp the phone
 *    already has. Nothing is sent, nothing is logged, no message row is
 *    written. The full API is a v2 item; this covers the near-term need.
 *  - **Not an anchor.** A plain `<a href="https://wa.me/…">` inside the
 *    Capacitor WebView navigates the WebView itself and unloads the app —
 *    and `isSystemScheme` does not match https, so the document-level
 *    interceptor never catches it. It goes through `openExternalAppUrl`.
 *
 * A number that will not normalise renders the button DISABLED rather than
 * hidden: a missing button reads as "this family has no number", which is a
 * different fact from "the number on file is unusable" and sends staff
 * looking in the wrong place.
 */
export function WhatsAppButton({ mobile, name, className }: WhatsAppButtonProps) {
  const href = whatsappHref(mobile)
  const who = name?.trim()

  if (!href) {
    return (
      <button
        type="button"
        disabled
        aria-label={who ? `WhatsApp ${who} — number unusable` : 'WhatsApp — number unusable'}
        title="No usable WhatsApp number on file"
        className={cn(
          'tap inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2',
          'text-muted/40',
          className,
        )}
      >
        <MessageCircleIcon className="h-5 w-5" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => openExternalAppUrl(href)}
      aria-label={who ? `WhatsApp ${who}` : 'WhatsApp'}
      className={cn(
        'tap inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2',
        'text-ledger-green active:opacity-70',
        className,
      )}
    >
      <MessageCircleIcon className="h-5 w-5" />
    </button>
  )
}
