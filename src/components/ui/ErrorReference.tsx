'use client'

import { useState } from 'react'

import { CopyIcon } from '@/components/icons'

/**
 * The failure reference, in a form someone can actually send you.
 *
 * The digest alone was rendered as plain text, which on a handset means a
 * staff member hand-transcribing a hex string off a phone screen into
 * WhatsApp — the step where a bug report stops being traceable. It also does
 * not say WHICH BUILD failed, and in remote-shell mode a handset can be
 * running an older bundle than you think, so the same digest could come from
 * code you have already replaced.
 *
 * So: digest, build SHA, path and timestamp, and one tap to copy all four.
 *
 * The build SHA comes from NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA, which Vercel
 * injects when system environment variables are exposed (the default). It is
 * rendered only when present — locally and in any build without it, the block
 * degrades to the digest rather than showing an empty label. The same SHA is
 * what /api/version reports, so a screenshot and that endpoint can be compared
 * directly to tell a stale handset from a real failure.
 */
export function ErrorReference({ digest }: { digest?: string }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  const build = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  const shortBuild = build ? build.slice(0, 7) : null

  // Nothing worth copying and nothing worth showing.
  if (!digest && !shortBuild) return null

  const report = [
    digest ? `ref ${digest}` : null,
    shortBuild ? `build ${shortBuild}` : null,
    typeof window !== 'undefined' ? `path ${window.location.pathname}` : null,
    new Date().toISOString(),
  ]
    .filter(Boolean)
    .join(' · ')

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      // Clipboard is refused in an insecure context and on some Android
      // WebViews. Say so rather than showing a false "Copied" — the whole
      // point of this block is that the reference reaches someone.
      setCopyFailed(true)
    }
  }

  return (
    <div className="mt-1 flex flex-col items-center gap-1.5">
      <p className="figure text-xs break-all text-muted">
        {digest ? <>Reference {digest}</> : null}
        {digest && shortBuild ? ' · ' : null}
        {shortBuild ? <>build {shortBuild}</> : null}
      </p>

      <button
        type="button"
        onClick={() => void handleCopy()}
        className="tap inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 font-mono text-xs tracking-eyebrow text-brand uppercase"
      >
        <CopyIcon className="h-4 w-4" />
        {copied ? 'Copied' : 'Copy details'}
      </button>

      {copyFailed ? (
        <p className="max-w-xs text-xs leading-snug text-muted">
          Could not copy automatically — screenshot this screen and note the time.
        </p>
      ) : null}
    </div>
  )
}

export default ErrorReference
