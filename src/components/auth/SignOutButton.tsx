'use client'

import { startTransition, useState } from 'react'

import { signOut } from '@/lib/actions/auth'
import { clearClaims } from '@/lib/native/session-keeper'
import { cn } from '@/lib/utils'
import { LogOutIcon } from '@/components/icons'

export interface SignOutButtonProps {
  /** Icon-only, for the sticky header. */
  compact?: boolean
  className?: string
}

export function SignOutButton({ compact = false, className }: SignOutButtonProps) {
  const [pending, setPending] = useState(false)

  function handleSignOut() {
    setPending(true)
    // Clear the durable copy of the code-auth claims so a later remount
    // cannot resurrect a signed-out session. The server action deletes the
    // httpOnly cookies and redirects to /login.
    void clearClaims().finally(() => {
      startTransition(() => {
        void signOut()
      })
    })
  }

  return (
    <button
      type="button"
      aria-label="Sign out"
      disabled={pending}
      onClick={handleSignOut}
      className={cn(
        'tap inline-flex min-h-12 items-center justify-center gap-2 rounded-xl font-medium text-fg hover:bg-surface-2 active:bg-surface-2 active:opacity-80',
        compact ? 'w-12' : 'border border-border bg-surface px-4',
        className,
      )}
    >
      <LogOutIcon className="h-5 w-5" />
      {compact ? null : <span>Sign out</span>}
    </button>
  )
}

export default SignOutButton
