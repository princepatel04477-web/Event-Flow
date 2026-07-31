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

export default CreateEventForm
