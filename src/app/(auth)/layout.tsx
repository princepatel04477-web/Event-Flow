import type { ReactNode } from 'react'

/**
 * The sign-in ground.
 *
 * A single very soft gold wash off the brand tint rising from the bottom edge
 * over the warm ivory ground. It is the only screen in the app with a gradient:
 * sign-in is the one moment nobody is working, so it can afford to be
 * atmosphere rather than instrument. Every screen past it is flat.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-dvh flex-col bg-paper px-safe pt-safe pb-safe"
      style={{
        backgroundImage:
          'radial-gradient(120% 62% at 50% 108%, var(--ef-brand-tint), transparent 62%)',
      }}
    >
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-7 py-8">
        {children}
      </main>
    </div>
  )
}
