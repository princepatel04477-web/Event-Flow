'use client'

import { useState } from 'react'

import { ClockIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  CALLBACK_CHIPS,
  callbackChipToValue,
  type CallbackChipId,
} from '@/lib/rsvp-log'
import { cn } from '@/lib/utils'

interface CallbackCaptureStepProps {
  onSave: (callbackDatetime: string) => void
  onCancel: () => void
  isSaving?: boolean
}

export function CallbackCaptureStep({
  onSave,
  onCancel,
  isSaving = false,
}: CallbackCaptureStepProps) {
  const [selectedChip, setSelectedChip] = useState<CallbackChipId>('1hour')
  const [customDatetime, setCustomDatetime] = useState<string>('')

  function handleSave() {
    const value = callbackChipToValue(selectedChip, new Date(), customDatetime)
    if (!value) return
    onSave(value)
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border-2 border-brand/35 bg-surface p-4 shadow-e2 transition-all animate-in fade-in slide-in-from-top-2 duration-200"
      role="region"
      aria-label="Pick callback time"
    >
      <div className="flex items-center justify-between border-b border-rule pb-2">
        <div className="flex items-center gap-2">
          <ClockIcon className="h-5 w-5 text-brand" aria-hidden />
          <h3 className="text-base font-bold text-ink">When should we call back?</h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-semibold text-muted underline hover:text-ink active:text-brand"
        >
          Cancel
        </button>
      </div>

      <p className="text-xs text-muted -mt-1">
        Select a reminder slot so this family appears in the callback list at the right time.
      </p>

      {/* Call-back chips: In 1 hour / This evening / Tomorrow morning / Pick time */}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Callback time options">
        {CALLBACK_CHIPS.map((chip) => {
          const isSelected = selectedChip === chip.id
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setSelectedChip(chip.id)}
              className={cn(
                'tap flex min-h-12 items-center justify-center rounded-xl border px-3 text-xs font-semibold text-center',
                'transition-[background-color,border-color,color] duration-press ease-ledger',
                isSelected
                  ? 'border-brand bg-brand-tint text-brand ring-2 ring-brand/30'
                  : 'border-rule-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
              )}
            >
              {chip.label}
            </button>
          )
        })}
      </div>

      {selectedChip === 'custom' ? (
        <div className="mt-1">
          <Input
            type="datetime-local"
            label="Pick date and time"
            value={customDatetime}
            onChange={(e) => setCustomDatetime(e.target.value)}
          />
        </div>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        fullWidth
        disabled={isSaving || (selectedChip === 'custom' && !customDatetime)}
        onClick={handleSave}
      >
        {isSaving ? 'Saving...' : 'Save callback & next family'}
      </Button>
    </div>
  )
}
