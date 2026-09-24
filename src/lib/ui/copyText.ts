/**
 * Copying text to the clipboard, with a failure that is visible.
 *
 * `navigator.clipboard.writeText()` REJECTS on an http origin and in an
 * unfocused WebView. A caller that fires it with `void` and then flips a label
 * to "Copied" claims a success that did not happen — the runner pastes an empty
 * clipboard into WhatsApp and the message never arrives (m6). This wraps the one
 * call so every caller behaves the same way: the label changes only when the
 * write actually resolved.
 *
 * The clipboard is a parameter rather than a module-level read of `navigator`,
 * so the failure path is testable without a DOM — pass a fake that resolves or
 * throws.
 */

/** The sentence to show when the write did not land. */
export const COPY_FAILED_MESSAGE =
  'Could not copy automatically. Select the message and copy it by hand, then paste it into WhatsApp.'

/** The slice of the Clipboard API this module needs, so a test can fake it. */
export interface ClipboardLike {
  writeText(text: string): Promise<void>
}

export type CopyResult = { ok: true } | { ok: false; message: string }

function defaultClipboard(): ClipboardLike | null {
  if (typeof navigator === 'undefined') return null
  const clipboard = navigator.clipboard
  if (!clipboard || typeof clipboard.writeText !== 'function') return null
  return clipboard
}

/**
 * Write `text` to the clipboard.
 *
 * Resolves `{ ok: true }` ONLY when the write resolved. A rejection, or a
 * browser with no clipboard API at all, comes back as `{ ok: false, message }`
 * carrying the sentence to show; the raw error is never surfaced.
 */
export async function copyText(
  text: string,
  clipboard: ClipboardLike | null = defaultClipboard(),
): Promise<CopyResult> {
  if (!clipboard) return { ok: false, message: COPY_FAILED_MESSAGE }
  try {
    await clipboard.writeText(text)
    return { ok: true }
  } catch {
    return { ok: false, message: COPY_FAILED_MESSAGE }
  }
}
