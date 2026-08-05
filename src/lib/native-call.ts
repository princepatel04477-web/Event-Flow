'use client'

import { dialTarget } from '@/lib/phone'

/**
 * M6 native call wrapper.
 *
 * On native (Capacitor), dials through the CallPlugin so we get direct dial
 * (no confirm screen) AND automatic call-state events ('callStarted' /
 * 'callEnded') for duration + connected tracking. On the web, falls back to
 * the plain `tel:` href (system dialer opens) with no state events — the
 * call screen's manual outcome logging still works.
 */
export async function dialNumber(raw: string | null | undefined): Promise<{
  native: boolean
  href: string
}> {
  const target = dialTarget(raw)
  if (!target) throw new Error('No dialable number')

  const isNative = typeof window !== 'undefined' && Boolean((window as any).Capacitor)
  if (isNative) {
    try {
      const { Call } = await import('./call/plugin')
      await Call.dial({ phoneNumber: target.dialedNumber })
      return { native: true, href: target.href }
    } catch {
      // Plugin missing or failed — fall through to tel: so the call still happens.
    }
  }

  // Web or plugin failure: open the tel: URL directly.
  window.location.href = target.href
  return { native: false, href: target.href }
}

export { dialTarget }
