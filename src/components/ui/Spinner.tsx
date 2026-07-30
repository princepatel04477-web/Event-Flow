import { cn } from '@/lib/utils'

export type SpinnerSize = 'sm' | 'md' | 'lg'

export interface SpinnerProps {
  size?: SpinnerSize
  className?: string
  /**
   * Announced to screen readers. Pass `null` when the spinner sits inside a
   * control that already says what is happening (e.g. a loading Button) so
   * it is not read out twice.
   */
  label?: string | null
}

const SIZES: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
}

export function Spinner({ size = 'md', className, label = 'Loading' }: SpinnerProps) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
    >
      <span
        className={cn(
          'animate-spin rounded-full border-current border-t-transparent',
          SIZES[size],
        )}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}

export default Spinner
