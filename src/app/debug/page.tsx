'use client'

import { useEffect, useState } from 'react'

import * as Sentry from '@sentry/react'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { SectionHead } from '@/components/ui/SectionHead'
import { isNativePlatform } from '@/lib/native/platform'
import { queuedProofCount, stuckProofs, type QueuedProof } from '@/lib/proof-queue'
import { supabase } from '@/lib/supabase/client'

type Diag = {
  appVersion: string
  capacitorVersion: string
  platform: string
  deviceModel: string
  osVersion: string
  user: string
  role: string
  online: boolean
}

/**
 * Hidden diagnostics screen (M5 Part C) — reachable at /debug.
 *
 * This is how a staff member tells us what's wrong over WhatsApp during the
 * event: one screenshot of this screen plus a clipboard copy. Shows app/
 * device/user/network state; the Sentry test-error button verifies the
 * pipeline end to end.
 */
export default function DebugPage() {
  const [diag, setDiag] = useState<Diag | null>(null)
  const [copied, setCopied] = useState(false)
  const [queued, setQueued] = useState(0)
  const [stuck, setStuck] = useState<QueuedProof[]>([])

  useEffect(() => {
    async function load() {
      // Not `Boolean(window.Capacitor)` — that global exists in browsers too,
      // so the debug screen reported every browser as native and then called
      // App.getInfo(), which only resolves in the APK.
      const isNative = isNativePlatform()

      let appVersion = 'web'
      let capacitorVersion = 'web'
      let platform = 'web'
      let deviceModel = 'n/a'
      let osVersion = 'n/a'

      if (isNative) {
        const [{ App }, { Device }, { Capacitor }] = await Promise.all([
          import('@capacitor/app'),
          import('@capacitor/device'),
          import('@capacitor/core'),
        ])
        const info = await App.getInfo()
        const dev = await Device.getInfo()
        appVersion = `${info.version} (${info.build})`
        capacitorVersion = Capacitor.getPlatform()
        platform = Capacitor.getPlatform()
        deviceModel = dev.model ?? 'unknown'
        osVersion = `${dev.platform} ${dev.osVersion ?? ''}`.trim()
      }

      const { data } = await supabase.auth.getUser()
      const role = data.user?.app_metadata?.role ?? 'unknown'

      setDiag({
        appVersion,
        capacitorVersion,
        platform,
        deviceModel,
        osVersion,
        user: data.user?.id ?? 'not signed in',
        role,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      })

      // M9: unsynced + stuck proof counts for the "needs attention" list.
      setQueued(await queuedProofCount())
      setStuck(await stuckProofs(3))
    }
    void load()
  }, [])

  function buildReport(d: Diag): string {
    return [
      `Event Ops diagnostics`,
      `App: ${d.appVersion}`,
      `Capacitor: ${d.capacitorVersion} · platform ${d.platform}`,
      `Device: ${d.deviceModel} · ${d.osVersion}`,
      `User: ${d.user} (${d.role})`,
      `Online: ${d.online}`,
      `Unsynced proofs: ${queued}`,
      `Stuck proofs: ${stuck.length}`,
    ].join('\n')
  }

  async function copy() {
    if (!diag) return
    try {
      await navigator.clipboard.writeText(buildReport(diag))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable in WebView — ignore */
    }
  }

  return (
    <main className="mx-auto w-full max-w-[480px] px-4 py-6">
      <SectionHead eyebrow="Debug" title="Diagnostics" />
      <p className="mt-1 text-sm text-muted">
        Send this screen to the event tech lead over WhatsApp if something is wrong.
      </p>

      <Card className="mt-4">
        <CardBody className="flex flex-col gap-2 text-sm">
          {diag ? (
            <>
              <Row k="App" v={diag.appVersion} />
              <Row k="Capacitor" v={`${diag.capacitorVersion} · ${diag.platform}`} />
              <Row k="Device" v={`${diag.deviceModel} · ${diag.osVersion}`} />
              <Row k="User" v={diag.user} mono />
              <Row k="Role" v={diag.role} />
              <Row k="Online" v={diag.online ? 'yes' : 'NO'} />
              <Row k="Unsynced proofs" v={String(queued)} />
              <Row k="Stuck proofs" v={String(stuck.length)} />
            </>
          ) : (
            <p className="text-muted">Reading device info…</p>
          )}
        </CardBody>
      </Card>

      {stuck.length > 0 ? (
        <Card className="mt-4 border-danger">
          <CardBody className="flex flex-col gap-2">
            <h3 className="font-semibold text-danger">Proofs needing attention</h3>
            {stuck.map((p) => (
              <div key={p.localId} className="text-sm">
                <span className="font-mono">{p.deliverableId.slice(0, 8)}</span>
                <span className="ml-2 text-muted">
                  {p.retries} retries · {p.lastError ?? 'unknown error'}
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <div className="mt-4 flex flex-col gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            Sentry.captureException(new Error('Test error from /debug (M5)'))
          }}
        >
          Send test error to Sentry
        </Button>
        <Button variant="secondary" onClick={copy}>
          {copied ? 'Copied!' : 'Copy diagnostics'}
        </Button>
      </div>
    </main>
  )
}

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className={`truncate text-right ${mono ? 'font-mono text-xs' : ''}`}>{v}</span>
    </div>
  )
}
