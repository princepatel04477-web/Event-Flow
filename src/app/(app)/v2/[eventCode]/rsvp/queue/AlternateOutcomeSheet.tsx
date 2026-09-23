'use client'

import { useState } from 'react'

import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Input } from '@/components/ui/Input'
import {
  CALLBACK_CHIPS,
  callbackChipToValue,
  type CallbackChipId,
} from '@/lib/rsvp-log'

export interface AlternateOutcomeSheetProps {
  open: boolean
  onClose: () => void
  onSaveCallback: (callbackDatetime: string) => void
  onPickMaybe: () => void
  isSaving?: boolean
}

export function AlternateOutcomeSheet({
  open,
  onClose,
  onSaveCallback,
  onPickMaybe,
  isSaving = false,
}: AlternateOutcomeSheetProps) {
  const [selectedChip, setSelectedChip] = useState<CallbackChipId>('1hour')
  const [customDatetime, setCustomDatetime] = useState<string>('')

  function handleSaveCallback() {
    const value = callbackChipToValue(selectedChip, new Date(), customDatetime)
    if (!value) return
    onSaveCallback(value)
  }

  return (
    <BottomSheet open={open} onClose={onClose} label="Call back or maybe">
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-sm text-muted">Pick when to call back, or log them as maybe.</p>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Callback time">
          {CALLBACK_CHIPS.map((chip) => (
            <Chip
              key={chip.id}
              selected={selectedChip === chip.id}
              onClick={() => setSelectedChip(chip.id)}
            >
              {chip.label}
            </Chip>
          ))}
        </div>

        {selectedChip === 'custom' ? (
          <Input
            type="datetime-local"
            label="Pick date and time"
            value={customDatetime}
            onChange={(e) => setCustomDatetime(e.target.value)}
          />
        ) : null}

        <Button
          variant="primary"
          fullWidth
          disabled={
            isSaving || (selectedChip === 'custom' && !customDatetime)
          }
          onClick={handleSaveCallback}
        >
          Save call back
        </Button>

        <Button
          variant="secondary"
          fullWidth
          disabled={isSaving}
          onClick={() => {
            onPickMaybe()
            onClose()
          }}
        >
          Maybe — capture details
        </Button>
      </div>
    </BottomSheet>
  )
}
