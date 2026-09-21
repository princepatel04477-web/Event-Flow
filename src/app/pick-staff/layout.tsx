import type { ReactNode } from 'react'

/** Same safe-area shell as sign-in — pick-staff sits outside (auth) and (staff). */
export default function PickStaffLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper px-safe pt-safe pb-safe">
      <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col px-4 py-6">
        {children}
      </main>
    </div>
  )
}
