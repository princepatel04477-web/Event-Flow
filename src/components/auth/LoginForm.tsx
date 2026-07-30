'use client'

import { useActionState } from 'react'

import { signIn, type SignInState } from '@/lib/actions/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

const INITIAL_STATE: SignInState = { error: null }

export interface LoginFormProps {
  /** Already sanitised by the page — see `safeRedirectPath`. */
  next: string
}

export function LoginForm({ next }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE)

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-base font-medium text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <Input
        name="email"
        type="email"
        label="Email"
        placeholder="you@example.com"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        required
      />

      <Input
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        enterKeyHint="go"
        required
      />

      <Button type="submit" size="lg" fullWidth loading={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}

export default LoginForm
