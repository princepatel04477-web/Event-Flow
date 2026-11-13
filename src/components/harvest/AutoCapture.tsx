'use client'

/**
 * Automatic capture of the recordings the phone's own dialer makes.
 *
 * THE SHAPE OF THE FEATURE, AND ITS ONE HONEST LIMIT
 *
 * Staff dial from wherever they like — the app, contacts, a missed-call list.
 * The OEM dialer records the call to a folder on the phone. This component
 * asks for the two things that cannot be assumed (file access, and consent),
 * then watches those folders and files every finished recording against the
 * family it belongs to.
 *
 * It only runs while this screen is open. A WebView cannot watch the
 * filesystem in the background, and a status line that implied otherwise would
 * be worse than no feature: staff would stop recording summaries because they
 * believed the calls were already captured. So the copy says "while this
 * screen is open", and the sweep on mount catches whatever happened while it
 * was not.
 *
 * CONSENT IS A GATE, NOT A CHECKBOX FOR THE FILE
 *
 * `transcribe-recording` refuses any recording with `consent_given = false`,
 * and `call_recordings` is insert-only — a row filed without consent is audio
 * that can never be transcribed and never corrected. So consent is asked once
 * per event, before capture starts, and no file moves until it is given.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardTitle } from '@/components/ui/Card'
import {
  discoverFolders,
  hasPermission,
  isHarvestAvailable,
  onRecordingDetected,
  requestPermission,
  startWatching,
  stopWatching,
} from '@/lib/harvest'
import { SWEEP_INTERVAL_MS, sweepHarvest, type SweepOutcome } from '@/lib/harvest-sweep'

type Phase =
  /** Not a handset, or an APK with no harvest plugin. Render nothing. */
  | 'unsupported'
  | 'checking'
  /** Android has not granted all-files access yet. */
  | 'needs-permission'
  /** Permission held, consent not yet given for this event. */
  | 'needs-consent'
  | 'watching'

interface AutoCaptureProps {
  eventId: string
  eventCode: string
}

/**
 * Consent and the capture start time live per event, on this handset. A fresh
 * `enabledAt` on every enable is deliberate: it is the floor that stops the
 * phone's back catalogue of pre-consent calls being swept up.
 */
function consentKey(eventId: string): string {
  return `eventflow.harvest.consent.${eventId}`
}

function readConsent(eventId: string): number | null {
  try {
    const raw = localStorage.getItem(consentKey(eventId))
    if (!raw) return null
    const at = Number(raw)
    return Number.isFinite(at) ? at : null
  } catch {
    // Private mode, or site data blocked. Treat as "not given" and ask again.
    return null
  }
}

function writeConsent(eventId: string, at: number): void {
  try {
    localStorage.setItem(consentKey(eventId), String(at))
  } catch {
    // Non-fatal: capture still runs this session, it just asks again next time.
  }
}

/**
 * Local midnight — the floor for "include today's earlier calls".
 *
 * The reason the floor exists at all is the phone's back catalogue: a handset
 * in service for weeks holds calls made before anyone agreed to hand them
 * over, and `call_recordings` cannot be updated or deleted, so an upload
 * cannot be taken back. Today is a deliberate, bounded exception — staff who
 * turn capture on at lunchtime would otherwise lose the morning's calls with
 * no way to recover them, and they know what they did this morning. Anything
 * before today still needs the unmatched tray and a human.
 */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function describe(outcome: SweepOutcome | null, total: number, totalSkipped: number): string {
  const parts: string[] = []
  if (total > 0) {
    parts.push(`${total} recording${total === 1 ? '' : 's'} sent for transcription.`)
  }
  if (totalSkipped > 0) {
    parts.push(`${totalSkipped} reminder call${totalSkipped === 1 ? '' : 's'} skipped.`)
  }
  if (parts.length > 0) {
    return parts.join(' ')
  }
  if (outcome?.unmatched) {
    return 'A recording could not be matched to a family — attach it in the unmatched tray.'
  }
  if (outcome?.deferred) {
    return 'A recording is still being written. It will be picked up shortly.'
  }
  return 'Watching for finished calls.'
}

export function AutoCapture({ eventId, eventCode }: AutoCaptureProps) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<SweepOutcome | null>(null)
  const [totalUploaded, setTotalUploaded] = useState(0)
  const [totalSkipped, setTotalSkipped] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)

  const enabledAtRef = useRef<number | null>(null)
  const foldersRef = useRef<string[]>([])
  // A sweep reads files and uploads; two at once would race the same path onto
  // two Storage objects. One at a time, always.
  const runningRef = useRef(false)

  const runSweep = useCallback(async () => {
    const enabledAt = enabledAtRef.current
    if (enabledAt === null || runningRef.current) return
    runningRef.current = true
    try {
      const result = await sweepHarvest({
        eventId,
        eventCode,
        enabledAt,
        consentGiven: true,
        folders: foldersRef.current,
      })
      setOutcome(result)
      setProblem(result.lastError ?? null)
      if (result.uploaded > 0) setTotalUploaded((n) => n + result.uploaded)
      if (result.skipped > 0) setTotalSkipped((n) => n + result.skipped)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The last check did not finish.')
    } finally {
      runningRef.current = false
    }
  }, [eventId, eventCode])

  // --- Where we stand, before anything is asked of the user ---------------
  useEffect(() => {
    let alive = true
    void (async () => {
      if (!isHarvestAvailable()) {
        if (alive) setPhase('unsupported')
        return
      }
      const granted = await hasPermission()
      if (!alive) return
      if (!granted) {
        setPhase('needs-permission')
        return
      }
      const consentAt = readConsent(eventId)
      if (consentAt === null) {
        setPhase('needs-consent')
        return
      }
      enabledAtRef.current = consentAt
      setPhase('watching')
    })()
    return () => {
      alive = false
    }
  }, [eventId])

  // --- The watcher and the timer, once capture is live --------------------
  useEffect(() => {
    if (phase !== 'watching') return
    let alive = true
    let unlisten: (() => void) | null = null

    void (async () => {
      foldersRef.current = await discoverFolders()
      if (!alive) return
      if (foldersRef.current.length === 0) {
        setProblem(
          'No call-recording folder was found on this phone. Turn on call recording in the ' +
            'dialer, make one test call, then reopen this screen.',
        )
        return
      }
      await startWatching(foldersRef.current)
      if (!alive) return
      // The event is the fast path; the sweep below is what makes it certain.
      unlisten = onRecordingDetected(() => {
        void runSweep()
      })
      await runSweep()
    })()

    const timer = setInterval(() => {
      void runSweep()
    }, SWEEP_INTERVAL_MS)

    return () => {
      alive = false
      clearInterval(timer)
      if (unlisten) unlisten()
      void stopWatching()
    }
  }, [phase, runSweep])

  async function handleGrant() {
    setBusy(true)
    setProblem(null)
    try {
      const granted = await requestPermission()
      if (!granted) {
        setProblem(
          'Android did not grant all-files access, so recordings cannot be read. ' +
            'Open Settings › Apps › EventFlow › Permissions and allow "All files access", then try again.',
        )
        return
      }
      setPhase(readConsent(eventId) === null ? 'needs-consent' : 'watching')
    } finally {
      setBusy(false)
    }
  }

  function handleConsent(includeToday: boolean) {
    const at = includeToday ? startOfToday() : Date.now()
    writeConsent(eventId, at)
    enabledAtRef.current = at
    setPhase('watching')
  }

  if (phase === 'unsupported' || phase === 'checking') return null

  // Once it is running this is not a feature any more, it is a background
  // fact — so it gets one line at the top of the calling screen, not a card
  // competing with the family being called.
  if (phase === 'watching') {
    return (
      <p className="text-sm text-muted">
        <span className="font-semibold text-fg">Call capture on.</span>{' '}
        {problem ?? describe(outcome, totalUploaded, totalSkipped)}{' '}
        <span className="text-muted">Works while this screen is open.</span>
      </p>
    )
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <CardTitle>Automatic call capture</CardTitle>

        {phase === 'needs-permission' ? (
          <>
            <p className="text-sm text-muted">
              To send your calls for transcription on their own, EventFlow needs to read the
              recordings your phone&apos;s dialer saves. Android calls this{' '}
              <strong>All files access</strong>.
            </p>
            <Button variant="primary" onClick={handleGrant} disabled={busy}>
              {busy ? 'Waiting for Android…' : 'Allow access to recordings'}
            </Button>
          </>
        ) : null}

        {phase === 'needs-consent' ? (
          <>
            <p className="text-sm text-muted">
              Every recording sent from here is transcribed and read by the office. Confirm that
              families are told the call is being recorded.
            </p>
            <Button variant="primary" onClick={() => handleConsent(false)}>
              Families are told — capture from now on
            </Button>
            {/* Deliberately a second, plainer control rather than a checkbox on
                the first one: it sends calls that were already recorded, so it
                should be chosen, not left ticked by whoever used the phone
                last. Older than today still needs the unmatched tray. */}
            <Button variant="secondary" onClick={() => handleConsent(true)}>
              Capture today&apos;s earlier calls too
            </Button>
            <p className="text-sm text-muted">
              Nothing recorded before today is ever sent.
            </p>
          </>
        ) : null}

        {problem ? <p className="text-sm text-warning">{problem}</p> : null}
      </CardBody>
    </Card>
  )
}
