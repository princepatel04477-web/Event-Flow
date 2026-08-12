import type { ReactNode } from 'react'

/**
 * The sign-in ground.
 *
 * Two very soft radial washes — brass rising from the bottom edge, a trace
 * of verdigris at the top left — over the flat night teal. It is the only
 * screen in the app with a gradient: sign-in is the one moment nobody is
 * working, so it can afford to be atmosphere rather than instrument. Every
 * screen past it is flat.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-dvh flex-col bg-paper px-safe pt-safe pb-safe"
      style={{
        backgroundImage:
          'radial-gradient(120% 62% at 50% 108%, rgba(201,169,107,0.17), transparent 62%), ' +
          'radial-gradient(90% 45% at 12% -8%, rgba(79,193,160,0.07), transparent 60%)',
      }}
    >
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-7 py-8">
        {children}
      </main>
    </div>
  )
}
