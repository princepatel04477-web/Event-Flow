import { signOut } from '@/lib/actions/auth'
import { cn } from '@/lib/utils'
import { LogOutIcon } from '@/components/icons'

export interface SignOutButtonProps {
  /** Icon-only, for the sticky header. */
  compact?: boolean
  className?: string
}

export function SignOutButton({ compact = false, className }: SignOutButtonProps) {
  return (
    <form action={signOut}>
      <button
        type="submit"
        aria-label="Sign out"
        className={cn(
          'tap inline-flex min-h-11 items-center justify-center gap-2 rounded-xl font-medium text-fg hover:bg-surface-2',
          compact ? 'w-11' : 'border border-border bg-surface px-4',
          className,
        )}
      >
        <LogOutIcon className="h-5 w-5" />
        {compact ? null : <span>Sign out</span>}
      </button>
    </form>
  )
}

export default SignOutButton
