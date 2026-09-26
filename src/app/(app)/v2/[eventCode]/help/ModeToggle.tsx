'use client'

import { useEffect, useState } from 'react'

import { Pressable } from '@/components/ui/Pressable'
import { applyMode, readMode, setMode, watchSystemMode, type ThemeMode } from '@/lib/theme/mode'
import { cn } from '@/lib/utils'

const OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

/**
 * The three-state appearance control (M2).
 *
 * Lives on the help screen because that is the app's only "settings" surface —
 * the header deliberately has no overflow menu (SPEC-V3 §3), and inventing one
 * for a toggle would put a control in front of every runner to serve the few who
 * change it.
 *
 * The document is the source of truth, not this component: the choice is
 * persisted by `setMode` and re-applied on mount from `readMode`, so a remount
 * (or an inline-scripted cold start) converges on the stored value without this
 * component holding authoritative state.
 */
export function ModeToggle() {
  const [mode, setLocalMode] = useState<ThemeMode>('light')

  useEffect(() => {
    let cancelled = false
    void readMode().then((stored) => {
      if (cancelled) return
      setLocalMode(stored)
      void applyMode(stored)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // While 'system' is chosen, follow the OS live.
  useEffect(() => {
    if (mode !== 'system') return
    return watchSystemMode(() => {
      void applyMode('system')
    })
  }, [mode])

  async function choose(next: ThemeMode) {
    setLocalMode(next)
    await setMode(next)
  }

  return (
    <section
      aria-label="Appearance"
      className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-4"
    >
      <span className="text-sm font-medium text-ink">Appearance</span>
      <div role="group" aria-label="Appearance" className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {OPTIONS.map((option) => {
          const selected = mode === option.value
          return (
            <Pressable
              key={option.value}
              onPress={() => void choose(option.value)}
              aria-pressed={selected}
              className={cn(
                'min-h-11 flex-1 rounded-lg px-3 text-sm font-medium',
                selected ? 'bg-surface text-ink shadow-e1' : 'text-muted',
              )}
            >
              {option.label}
            </Pressable>
          )
        })}
      </div>
    </section>
  )
}

export default ModeToggle
