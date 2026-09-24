import { describe, expect, it } from 'vitest'

import { COPY_FAILED_MESSAGE, copyText } from '@/lib/ui/copyText'

/**
 * m6 — the copy button used to fire `void navigator.clipboard.writeText(...)`
 * and flip its label to "Copied" regardless of the outcome. On an http origin
 * or an unfocused WebView the write rejects, so the runner pasted an empty
 * clipboard into WhatsApp.
 *
 * The helper is the testable half: a promise that resolves is a success, a
 * promise that rejects (or no clipboard API at all) is a failure carrying the
 * sentence to show. The raw failure text must never reach the screen.
 */
describe('copyText', () => {
  it('reports success and writes the text when the clipboard resolves', async () => {
    const written: string[] = []
    const result = await copyText('Hello driver', {
      writeText: (text) => {
        written.push(text)
        return Promise.resolve()
      },
    })

    expect(result).toEqual({ ok: true })
    expect(written).toEqual(['Hello driver'])
  })

  it('reports failure when the clipboard write rejects', async () => {
    const result = await copyText('Hello driver', {
      writeText: () => Promise.reject(new Error('NotAllowedError')),
    })

    expect(result).toEqual({ ok: false, message: COPY_FAILED_MESSAGE })
  })

  it('reports failure when the browser has no clipboard API', async () => {
    const result = await copyText('Hello driver', null)

    expect(result.ok).toBe(false)
    expect(result).toEqual({ ok: false, message: COPY_FAILED_MESSAGE })
  })

  it('never surfaces the raw failure text', async () => {
    const result = await copyText('Hello driver', {
      writeText: () => Promise.reject(new Error('permission denied for table delivery_proofs')),
    })

    const message = result.ok ? '' : result.message
    expect(message).not.toContain('permission denied')
    expect(message).not.toContain('delivery_proofs')
    expect(message).toContain('copy it by hand')
  })
})
