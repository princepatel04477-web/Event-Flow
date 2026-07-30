import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col justify-center bg-bg px-safe">
      <main className="mx-auto w-full max-w-md px-5 py-10">{children}</main>
    </div>
  )
}
