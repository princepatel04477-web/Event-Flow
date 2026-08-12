'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  MicIcon,
  RefreshIcon,
  StopIcon,
  UploadIcon,
} from '@/components/icons'
import {
  getCapability,
  requestPermission,
  startRecording,
  type RecorderCapability,
  type RecordingSession,
} from '@/lib/native/recorder'
import { buildStoragePath, commitVoiceNote, drainVoiceNotes } from '@/lib/voice-note/upload'
import { listQueuedVoiceNotes, type PendingVoiceNote } from '@/lib/voice-note/outbox'

/** Three minutes. Long enough for a family summary, short enough to upload on venue Wi-Fi. */
const MAX_SECONDS = 180

/**
 * Sarvam skips anything under ten seconds (`error_text='too_short'`, no API
 * call, see CLAUDE.md §9). Warn before the upload rather than let a staff
 * member believe a two-second note was transcribed.
 */
const MIN_USEFUL_SECONDS = 10

type Phase =
  | 'checking'   // probing capability; nothing rendered yet
  | 'blocked'    // cannot record, and we know why
  | 'prompt'     // ready to record
  | 'recording'
  | 'review'     // captured; play it back, then keep or discard
  | 'uploading'
  | 'done'
  | 'queued'     // held on this phone, will sync
  | 'error'
  | 'hidden'     // dismissed

interface Props {
  eventId: string
  eventCode: string
  groupId: string
  callAttemptId: string
  /** Called after a recording is committed or queued, so the parent can refresh. */
  onDone?: () => void
}

interface Captured {
  blob: Blob
  url: string
  mimeType: string
  extension: string
  durationSec: number
}

export function VoiceNoteRecorder({
  eventId,
  eventCode,
  groupId,
  callAttemptId,
  onDone,
}: Props) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [capability, setCapability] = useState<RecorderCapability | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [captured, setCaptured] = useState<Captured | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [queuedCount, setQueuedCount] = useState(0)

  const session = useRef<RecordingSession | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const levelRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const capturedRef = useRef<Captured | null>(null)

  /**
   * Stop both intervals. The old implementation cleared the timer only on a
   * manual stop, so hitting the three-minute cap left it ticking for the life
   * of the page.
   */
  const clearTimers = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    if (levelRef.current) { clearInterval(levelRef.current); levelRef.current = null }
  }, [])

  // Probe what this device can do BEFORE anything is tappable, so the control
  // can render disabled-with-a-reason. A button that silently does nothing is
  // the failure mode this whole component was rewritten to remove.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cap = await getCapability()
      if (cancelled) return
      setCapability(cap)
      setPhase(cap.permission === 'unsupported' || cap.permission === 'denied' ? 'blocked' : 'prompt')
    })()
    return () => { cancelled = true }
  }, [])

  // Drain anything held from an earlier session, and whenever signal returns.
  useEffect(() => {
    let cancelled = false

    async function drain() {
      await drainVoiceNotes()
      const remaining = await listQueuedVoiceNotes()
      if (cancelled) return
      setQueuedCount(remaining.length)
      if (remaining.some((n) => n.callAttemptId === callAttemptId)) setPhase('queued')
    }

    void drain()
    window.addEventListener('online', drain)
    return () => {
      cancelled = true
      window.removeEventListener('online', drain)
    }
  }, [callAttemptId])

  // Hard stop at the cap. Driven off state rather than from inside the tick's
  // updater so the stop happens exactly once.
  useEffect(() => {
    if (phase === 'recording' && elapsed >= MAX_SECONDS) void finishRecording()
    // finishRecording closes over refs only; re-running on its identity would
    // restart this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, elapsed])

  // Release the microphone and the object URL on unmount. An open session
  // holds the mic and leaves Android's recording indicator up.
  useEffect(() => {
    return () => {
      clearTimers()
      void session.current?.cancel()
      session.current = null
      if (capturedRef.current) URL.revokeObjectURL(capturedRef.current.url)
    }
  }, [clearTimers])

  function setCapturedAudio(next: Captured | null) {
    if (capturedRef.current) URL.revokeObjectURL(capturedRef.current.url)
    capturedRef.current = next
    setCaptured(next)
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  async function handleRecord() {
    setError(null)

    // Permission is requested at first use, never at app launch.
    if (capability?.permission !== 'granted') {
      const state = await requestPermission()
      const next = { ...(capability ?? { native: false, supportsLevel: false }), permission: state } as RecorderCapability
      setCapability(next)
      if (state !== 'granted') {
        setPhase('blocked')
        return
      }
    }

    try {
      const active = await startRecording()
      session.current = active
      setElapsed(0)
      setLevel(0)
      setPhase('recording')

      // The updater only advances the clock. Stopping is driven by the effect
      // below, because a state updater may be invoked twice (StrictMode) and
      // must stay free of side effects.
      tickRef.current = setInterval(() => {
        setElapsed((prev) => Math.min(prev + 1, MAX_SECONDS))
      }, 1000)

      if (active.level() !== null) {
        levelRef.current = setInterval(() => {
          setLevel(active.level() ?? 0)
        }, 100)
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not start recording: ${err.message}`
          : 'Could not start recording.',
      )
      setPhase('error')
    }
  }

  /** Stop capture and move to playback. Never uploads on its own. */
  async function finishRecording() {
    const active = session.current
    if (!active) return
    session.current = null
    clearTimers()

    try {
      const audio = await active.stop()
      setCapturedAudio({
        blob: audio.blob,
        url: URL.createObjectURL(audio.blob),
        mimeType: audio.mimeType,
        extension: audio.extension,
        // The native plugin reports its own duration; the web path measures
        // wall clock. Fall back to the on-screen timer if either returns 0.
        durationSec: audio.durationSec > 0 ? audio.durationSec : elapsed,
      })
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The recording could not be saved.')
      setPhase('error')
    }
  }

  async function handleDiscard() {
    setCapturedAudio(null)
    setElapsed(0)
    setPhase('prompt')
  }

  async function handleKeep() {
    if (!captured) return
    setPhase('uploading')
    setError(null)

    const note: PendingVoiceNote = {
      callAttemptId,
      eventId,
      eventCode,
      groupId,
      blob: captured.blob,
      mimeType: captured.mimeType,
      extension: captured.extension,
      durationSec: captured.durationSec,
      storagePath: buildStoragePath(eventId, groupId, captured.extension),
      queuedAt: new Date().toISOString(),
      attempts: 0,
    }

    try {
      const result = await commitVoiceNote(note)
      if (result.ok) {
        setCapturedAudio(null)
        setPhase('done')
        onDone?.()
        return
      }
      // Held, not lost. The count comes from the store rather than a local
      // increment, so a re-queue of the same attempt is not counted twice.
      const remaining = await listQueuedVoiceNotes()
      setQueuedCount(remaining.length)
      setError(result.error)
      setPhase('queued')
      onDone?.()
    } catch (err) {
      const remaining = await listQueuedVoiceNotes()
      setQueuedCount(remaining.length)
      setError(err instanceof Error ? err.message : 'Could not reach the server.')
      setPhase(remaining.some((n) => n.callAttemptId === callAttemptId) ? 'queued' : 'error')
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (phase === 'hidden' || phase === 'checking') return null

  const shell = 'flex flex-col gap-3 rounded-2xl border px-4 py-5'

  // ---- BLOCKED: never a dead button -------------------------------------
  if (phase === 'blocked') {
    const denied = capability?.permission === 'denied'
    return (
      <div className={`${shell} border-warning/40 bg-tint-warning`}>
        <div className="flex items-start gap-2.5">
          <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg">
              {denied ? 'Microphone permission is off' : 'Recording is not available on this device'}
            </p>
            <p className="mt-1 text-xs text-muted">
              {denied
                ? 'Android will not ask again once it has been refused. Turn it back on in ' +
                  'Settings → Apps → Nuvent → Permissions → Microphone, then come back and tap Record.'
                : capability?.reason ?? 'This device reports no way to record audio.'}
            </p>
            <p className="mt-2 text-xs text-subtle">
              The notes field above still works and is the fallback — nothing about this call is lost.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="md"
            fullWidth
            leadingIcon={<RefreshIcon className="h-4 w-4" />}
            onClick={async () => {
              const cap = await getCapability()
              setCapability(cap)
              setPhase(
                cap.permission === 'unsupported' || cap.permission === 'denied' ? 'blocked' : 'prompt',
              )
            }}
          >
            Check again
          </Button>
          <Button variant="ghost" size="md" onClick={() => setPhase('hidden')}>
            Dismiss
          </Button>
        </div>
      </div>
    )
  }

  // ---- PROMPT ------------------------------------------------------------
  if (phase === 'prompt') {
    return (
      <div className={`${shell} border-brand/40 bg-tint-brand`}>
        <p className="text-center text-sm font-medium text-fg">Record what the guest said?</p>
        <p className="text-center text-xs text-muted">
          Summarise the call out loud — travel details, pax, special requests. It is transcribed and
          extracted for you, and a human still reviews it before anything is saved to the family.
        </p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleRecord}
            leadingIcon={<MicIcon className="h-5 w-5" />}
          >
            Record
          </Button>
          <Button variant="ghost" size="md" className="shrink-0" onClick={() => setPhase('hidden')}>
            Skip
          </Button>
        </div>
        {queuedCount > 0 ? <QueuedLine count={queuedCount} /> : null}
      </div>
    )
  }

  // ---- RECORDING ---------------------------------------------------------
  if (phase === 'recording') {
    const remaining = MAX_SECONDS - elapsed
    const pct = (elapsed / MAX_SECONDS) * 100
    const warn = remaining <= 30

    return (
      <div className={`${shell} border-danger/40 bg-tint-danger`}>
        <div className="flex items-center gap-3">
          <span className="relative flex h-4 w-4 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-30" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-danger" />
          </span>
          <span className="flex-1 font-mono text-sm font-semibold text-fg">{formatTimer(elapsed)}</span>
          <span className={warn ? 'font-mono text-sm text-danger' : 'font-mono text-sm text-subtle'}>
            -{formatTimer(remaining)}
          </span>
        </div>

        {/* Live input level where the platform can report it. The native
            plugin exposes no amplitude API, so rather than animate something
            meaningless the pulse above stands in. */}
        {capability?.supportsLevel ? (
          <div className="flex items-center gap-1" aria-hidden>
            {Array.from({ length: 16 }, (_, i) => (
              <span
                key={i}
                className={
                  'h-6 flex-1 rounded-sm transition-colors duration-75 ' +
                  (level * 16 > i ? 'bg-danger' : 'bg-surface-2')
                }
              />
            ))}
          </div>
        ) : null}

        <div className="h-1.5 w-full rounded-full bg-surface-2">
          <div
            className="h-1.5 rounded-full bg-danger transition-all duration-1000"
            style={{ width: `${pct}%` }}
          />
        </div>

        <Button
          variant="danger"
          size="lg"
          fullWidth
          onClick={() => void finishRecording()}
          leadingIcon={<StopIcon className="h-5 w-5" />}
        >
          Stop recording
        </Button>
      </div>
    )
  }

  // ---- REVIEW: hear it before it is committed ----------------------------
  if (phase === 'review' && captured) {
    const tooShort = captured.durationSec < MIN_USEFUL_SECONDS
    return (
      <div className={`${shell} border-border bg-surface`}>
        <div>
          <p className="text-sm font-semibold text-fg">Listen before you keep it</p>
          <p className="mt-0.5 text-xs text-muted">
            {formatTimer(captured.durationSec)} recorded. A recording nobody checked is worth nothing —
            play it back, then decide.
          </p>
        </div>

        {/* The system audio element on purpose: familiar controls, a real
            scrubber, and it works on a cheap Android phone without us
            reimplementing playback. */}
        <audio controls src={captured.url} className="w-full" preload="metadata" />

        {tooShort ? (
          <p className="rounded-xl bg-tint-warning px-3 py-2 text-xs text-fg">
            Under {MIN_USEFUL_SECONDS} seconds. Transcription skips anything this short, so this will
            be stored but never transcribed. Re-record if you meant to say more.
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => void handleKeep()}
            leadingIcon={<UploadIcon className="h-5 w-5" />}
          >
            Keep it
          </Button>
          <Button variant="secondary" size="md" onClick={() => void handleDiscard()}>
            Discard
          </Button>
        </div>
      </div>
    )
  }

  // ---- UPLOADING ---------------------------------------------------------
  if (phase === 'uploading') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-6">
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-rule-strong border-t-brand"
          aria-hidden
        />
        <p className="text-sm font-medium text-fg">Saving recording…</p>
        <p className="text-xs text-muted">Uploading, then queueing it for transcription.</p>
      </div>
    )
  }

  // ---- DONE --------------------------------------------------------------
  if (phase === 'done') {
    return (
      <div className={`${shell} border-success/40 bg-tint-success`}>
        <div className="flex items-center gap-2">
          <CheckCircleIcon className="h-5 w-5 shrink-0 text-success" />
          <p className="text-sm font-semibold text-fg">Recording saved</p>
        </div>
        <p className="text-xs text-muted">
          It will be transcribed and land in the review queue. Nothing reaches the family record until
          someone approves it there.
        </p>
        {queuedCount > 0 ? <QueuedLine count={queuedCount} /> : null}
      </div>
    )
  }

  // ---- QUEUED: held on this phone ---------------------------------------
  if (phase === 'queued') {
    return (
      <div className={`${shell} border-warning/40 bg-tint-warning`}>
        <div className="flex items-center gap-2">
          <ClockIcon className="h-5 w-5 shrink-0 text-warning" />
          <p className="text-sm font-semibold text-fg">Saved on this phone</p>
        </div>
        <p className="text-xs text-muted">
          The recording could not be uploaded, so it is held here and will send itself the moment you
          are back online. It is not lost.
        </p>
        {error ? <p className="text-xs text-subtle">Last attempt: {error}</p> : null}
        <Button
          variant="secondary"
          size="md"
          fullWidth
          leadingIcon={<RefreshIcon className="h-4 w-4" />}
          onClick={async () => {
            const { synced } = await drainVoiceNotes()
            const remaining = await listQueuedVoiceNotes()
            setQueuedCount(remaining.length)
            if (synced > 0 && !remaining.some((n) => n.callAttemptId === callAttemptId)) {
              setPhase('done')
              onDone?.()
            }
          }}
        >
          Try sending now
        </Button>
      </div>
    )
  }

  // ---- ERROR -------------------------------------------------------------
  return (
    <div className={`${shell} border-danger/40 bg-tint-danger`}>
      <p className="text-sm font-medium text-danger">{error ?? 'Something went wrong.'}</p>
      <p className="text-xs text-muted">
        The notes field above is the fallback and still works.
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="md"
          onClick={() => { setError(null); setPhase('prompt') }}
        >
          Try again
        </Button>
        <Button variant="ghost" size="md" onClick={() => setPhase('hidden')}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}

function QueuedLine({ count }: { count: number }) {
  return (
    <p className="text-center text-xs text-subtle">
      {count} recording{count === 1 ? '' : 's'} on this phone still waiting to send.
    </p>
  )
}

function formatTimer(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
