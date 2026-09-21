'use client'

import { useEffect } from 'react'

/**
 * Keeps the phone shell stable when the soft keyboard opens.
 *
 * Without this, a fixed bottom tab bar stays pinned to the layout viewport
 * while the visual viewport shrinks — the page looks like it "zoomed" or
 * jumped, and the focused field can sit under the keyboard.
 */
export function MobileViewport() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const sync = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty('--keyboard-offset', `${keyboard}px`)
    }

    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    sync()

    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      document.documentElement.style.removeProperty('--keyboard-offset')
    }
  }, [])

  return null
}
