'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createEvent, type CreateEventState } from '@/lib/actions/events'
import { MAX_EVENT_CODE_LENGTH, normaliseEventCode } from './eventCode'

const INITIAL_STATE: CreateEventState = {
  error: null,
  fieldErrors: {},
  values: {
    name: '',
    code: '',
    brideName: '',
    groomName: '',
    startsOn: '',
    endsOn: '',
  },
}

/**
 * The create-event form.
 *
 * Field state is deliberately mixed, and the reason is worth writing down:
 *
 * - Every field except the code is UNCONTROLLED with a `defaultValue` fed
 *   from the action's echo. React resets an uncontrolled form once the action
 *   settles, and by then the new defaults are in place — so a refusal
 *   repopulates instead of blanking six fields somebody thumbed in on a
 *   phone. It also survives with JavaScript unavailable.
 * - The code IS controlled, because the preview under it has to track raw
 *   typing keystroke by keystroke. Local state keeps the raw text ("sharma
 *   26") while the preview shows what will actually be stored ("SHARMA26").
 *
 * Nothing here validates. The server action is the single source of truth on
 * what is acceptable, and the database is the only thing that knows whether a
 * code is free.
 */
export function CreateEventForm() {
  const [state, formAction, pending] = useActionState(createEvent, INITIAL_STATE)
  const [rawCode, setRawCode] = useState('')

  const codePreview = normaliseEventCode(rawCode)

  // Success: show the access codes exactly once, then hand over to the
  // event. The codes are never persisted in plaintext — this is the only
  // reveal, so the copy says so.
  if (state.created) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="font-display text-lg text-ink">Event created</h3>
          <p className="mt-1 text-sm text-muted">
            Share these access codes with your team and the client. They will only be shown
            this once — the event admin screen can reveal them again later, with every reveal
            logged.
          </p>

          <div className="mt-4 flex flex-col gap-3">
            <CodeReveal label="Event team" code={state.created.teamCode} />
            <CodeReveal label="Client (read-only)" code={state.created.clientCode} />
          </div>
        </div>

        {/* The event is usable the moment it exists. This block used to warn
            that nothing could be saved until a staff name was added, and made
            "Add staff" the primary action — correct while every insert policy
            ANDed `app.has_staff_identity`, wrong since migration
            20260814140000 removed that gate. Adding names is now purely about
            attribution, so it is offered, not demanded. */}
        <a
          href={`/${state.created.eventCode}`}
          className="tap inline-flex min-h-14 w-full items-center justify-center rounded-xl border border-transparent bg-ink px-5 py-3.5 text-lg font-semibold text-paper active:opacity-85"
        >
          Open {state.created.eventCode}
        </a>

        <a
          href={`/admin/events/${state.created.eventCode}/staff`}
          className="tap inline-flex min-h-14 w-full items-center justify-center rounded-xl border border-rule-strong bg-surface px-5 py-3.5 text-base font-semibold text-ink active:bg-surface-2"
        >
          Add staff names (optional)
        </a>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-base font-medium text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <Input
        name="name"
        label="Event name"
        placeholder="Sharma – Patel Wedding"
        defaultValue={state.values.name}
        error={state.fieldErrors.name}
        autoComplete="off"
        enterKeyHint="next"
        required
      />

      {/* maxLength is twice the stored ceiling on purpose: separators are
          stripped before the length is checked, so typing "sharma - patel -
          26" must not be cut off mid-word by the input. The server enforces
          the real limit against the normalised value. */}
      <Input
        name="code"
        label="Event code"
        placeholder="SHARMA26"
        value={rawCode}
        onChange={(e) => setRawCode(e.target.value)}
        error={state.fieldErrors.code}
        hint={
          codePreview ? (
            <>
              Saved as <span className="font-semibold text-fg">{codePreview}</span> — this
              becomes the web address <span className="font-mono">/{codePreview}</span> and
              is stamped into every Excel export. It must be unique.
            </>
          ) : (
            <>
              A short slug for the web address and for Excel exports. Letters and numbers
              only — anything else is dropped, and it is uppercased.
            </>
          )
        }
        maxLength={MAX_EVENT_CODE_LENGTH * 2}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        required
      />

      <Input
        name="bride_name"
        label="Bride"
        defaultValue={state.values.brideName}
        autoComplete="off"
        enterKeyHint="next"
      />

      <Input
        name="groom_name"
        label="Groom"
        defaultValue={state.values.groomName}
        autoComplete="off"
        enterKeyHint="next"
      />

      <Input
        name="starts_on"
        type="date"
        label="First day"
        defaultValue={state.values.startsOn}
        error={state.fieldErrors.startsOn}
        hint="Required. The Excel import reads dates written as “4th” against this event’s month, so the import cannot run until the event has a start date."
        required
      />

      <Input
        name="ends_on"
        type="date"
        label="Last day"
        defaultValue={state.values.endsOn}
        error={state.fieldErrors.endsOn}
        hint="Optional. Leave blank for a single-day event. Must be on or after the first day."
      />

      <Button type="submit" size="lg" fullWidth loading={pending}>
        {pending ? 'Creating…' : 'Create event'}
      </Button>
    </form>
  )
}

/** One access code with its role label, monospace, copyable. */
function CodeReveal({ label, code }: { label: string; code: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border-strong bg-surface-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</p>
        <p className="mt-0.5 font-mono text-xl font-semibold tracking-[0.15em] text-fg">{code}</p>
      </div>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(code)}
        className="tap min-h-12 shrink-0 rounded-lg border border-rule-strong bg-surface px-3 text-sm font-semibold text-ink active:bg-surface-2"
      >
        Copy
      </button>
    </div>
  )
}

export default CreateEventForm
