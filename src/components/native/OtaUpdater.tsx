'use client'

import { useEffect, useState } from 'react'

/**
 * OTA hotfix channel (M11) via @capgo/capacitor-updater, self-hosted on a
 * Supabase Storage bucket.
 *
 * Policy:
 * - On app resume, getLatest() -> download() -> next(). `next` stages the
 *   bundle to activate on the NEXT background/restart — never hot-swap
 *   mid-session, so a staff member halfway through a hamper delivery is not
 *   reloaded under their feet.
 * - notifyAppReady() on boot confirms the current bundle is healthy (the
 *   plugin auto-rolls-back if it is not called).
 * - Rollback: the plugin keeps the previous bundles; the /debug screen can
 *   reset to the last good one.
 * - LIMITATION (documented in CLAUDE.md): OTA ships JS/HTML/CSS only. Native
 *   changes need a full APK redistribution.
 *
 * The custom updateUrl is served from our own storage bucket (self-hosted).
 * All of this is a no-op on the web (the native updater plugin is absent).
 */
export function OtaUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).Capacitor) return

    let appHandle: { remove: () => void } | undefined

    async function init() {
      const [{ CapacitorUpdater }, { App }] = await Promise.all([
        import('@capgo/capacitor-updater'),
        import('@capacitor/app'),
      ])

      // Confirm the current bundle is healthy — prevents auto-rollback.
      void CapacitorUpdater.notifyAppReady()

      appHandle = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          void (async () => {
            try {
              const latest = await CapacitorUpdater.getLatest()
              if (!latest.url || latest.kind === 'up_to_date') return
              const bundle = await CapacitorUpdater.download({
                url: latest.url,
                version: latest.version,
              })
              // Stage for next background/restart — not now.
              await CapacitorUpdater.next({ id: bundle.id })
            } catch {
              /* offline or no update — ignore */
            }
          })()
        }
      })

      // Version manifest check (M10 step 11): non-dismissible update prompt.
      const manifestUrl = process.env.NEXT_PUBLIC_OTA_MANIFEST_URL
      if (manifestUrl) {
        try {
          const res = await fetch(manifestUrl, { cache: 'no-store' })
          if (res.ok) {
            const manifest = (await res.json()) as { versionCode?: number }
            const info = await App.getInfo()
            const installed = Number(info.build) || 0
            if ((manifest.versionCode ?? 0) > installed) {
              setUpdateAvailable(true)
            }
          }
        } catch {
          /* offline — skip the check */
        }
      }
    }

    void init()

    return () => {
      appHandle?.remove()
    }
  }, [])

  if (!updateAvailable) return null

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(32,30,29,.6)',
        color: '#201e1d',
        fontFamily: 'Figtree, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 360,
          width: '100%',
          background: '#fbf7ec',
          borderRadius: 16,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <h2 style={{ fontFamily: 'Caprasimo, Georgia, serif', fontWeight: 400, margin: '0 0 8px' }}>
          Update available
        </h2>
        <p style={{ margin: '0 0 16px', color: '#4a5568' }}>
          A newer version of the app is ready. Please update before continuing.
        </p>
        <a
          href={process.env.NEXT_PUBLIC_INSTALL_PAGE_URL ?? '/install.html'}
          style={{
            display: 'block',
            textDecoration: 'none',
            background: '#201e1d',
            color: '#f6efe1',
            borderRadius: 999,
            padding: '14px 24px',
            fontWeight: 700,
          }}
        >
          Update now
        </a>
      </div>
    </div>
  )
}

export default OtaUpdater
