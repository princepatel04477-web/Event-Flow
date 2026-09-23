import type { ReactNode } from 'react'

/**
 * The sign-in ground.
 *
 * A single very soft maroon wash off the brand tint rising from the bottom edge
 * over the warm paper ground. It is the only screen in the app with a gradient:
 * sign-in is the one moment nobody is working, so it can afford to be
 * atmosphere rather than instrument. Every screen past it is flat.
 *
 * VERTICALLY CENTRED (SPEC-V3 §4, "Login … centred"). The form used to hang
 * from the top of the viewport with the whole lower half empty, which put the
 * one field and the one button as far from the thumb as the screen allows.
 * `justify-center` on the content column is the whole change: the mark, the
 * field and the button now sit in the middle band of the phone, and a short
 * error message grows the block symmetrically instead of pushing the button
 * off the bottom.
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
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-7 py-8">
        {children}
      </main>
    </div>
  )
}
