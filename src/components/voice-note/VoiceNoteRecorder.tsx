'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { MicIcon, StopIcon, ChevronLeftIcon } from '@/components/icons'
import { uploadVoiceNote } from '@/lib/actions/voice-note'

const MAX_SECONDS = 180
const MIME_TYPE = 'audio/webm;codecs=opus' // recorder encodes; upload action stores as m4a

type Phase =
  | 'hidden'    // dismissed or not yet prompted
  | 'prompt'    // "Record what the guest said?"
  | 'recording' // actively capturing
  | 'uploading' // sending to server
  | 'done'      // uploaded successfully
  | 'error'

interface Props {
  eventId: string
  groupId: string
  callAttemptId: string
  /** Called after successful upload, so the parent can update state. */
  onDone?: () => void
}

export function VoiceNoteRecorder({ eventId, groupId, callAttemptId, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('prompt')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup on unmount — stop any active recording
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
        mediaRecorder.current.stop()
      }
    }
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, {
        audioBitsPerSecond: 32000,
      })
      chunks.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
      }

      recorder.start()
      mediaRecorder.current = recorder
      setElapsed(0)
      setPhase('recording')

      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          const next = prev + 1
          if (next >= MAX_SECONDS) {
            stopRecording(true)
            return MAX_SECONDS
          }
          return next
        })
      }, 1000)
    } catch (err) {
      const message = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access was denied. Grant the permission and try again.'
        : `Could not start recording: ${err instanceof Error ? err.message : 'unknown error'}`
      setError(message)
      setPhase('error')
    }
  }

  function stopRecording(autoStop = false) {
    if (!autoStop) clearTimer()
    const recorder = mediaRecorder.current
    if (!recorder || recorder.state !== 'recording') return

    recorder.onstop = async () => {
      // Stop camera stream tracks
      recorder.stream.getTracks().forEach((t) => t.stop())

      const blob = new Blob(chunks.current, { type: MIME_TYPE })
      if (blob.size === 0) {
        setError('The recording is empty. Try again.')
        setPhase('error')
        return
      }

      setPhase('uploading')

      try {
        const arrayBuffer = await blob.arrayBuffer()
        const base64 = btoa(
          Array.from(new Uint8Array(arrayBuffer), (b) => String.fromCharCode(b)).join(''),
        )

        const result = await uploadVoiceNote({
          eventId,
          groupId,
          callAttemptId,
          audioBase64: base64,
          durationSec: elapsed,
        })

        if (result.ok) {
          setPhase('done')
          onDone?.()
        } else {
          setError(result.error)
          setPhase('error')
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? `Could not upload: ${err.message}`
            : 'Could not reach the server. Check your connection.',
        )
        setPhase('error')
      }
    }

    recorder.stop()
  }

  if (phase === 'hidden') return null

  // ---- PROMPT ----------------------------------------------------------
  if (phase === 'prompt') {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-brand/40 bg-tint-brand px-4 py-5">
        <p className="text-center text-sm font-medium text-fg">
          Record what the guest said?
        </p>
        <p className="text-center text-xs text-muted">
          Summarise the call out loud — their travel details, special requests,
          anything that matters. The AI will transcribe and extract from this.
        </p>
        <div className="flex gap-2">
          <Button variant="primary" size="lg" fullWidth onClick={startRecording} leadingIcon={<MicIcon className="h-5 w-5" />}>
            Record
          </Button>
          <Button variant="ghost" size="md" className="shrink-0" onClick={() => setPhase('hidden')} aria-label="Dismiss">
            <ChevronLeftIcon className="h-5 w-5" />
          </Button>
        </div>
      </div>
    )
  }

  // ---- RECORDING -------------------------------------------------------
  if (phase === 'recording') {
    const remaining = MAX_SECONDS - elapsed
    const pct = (elapsed / MAX_SECONDS) * 100
    const warn = remaining <= 30

    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-danger/40 bg-tint-danger px-4 py-5">
        <div className="flex items-center gap-3">
          <span className="relative flex h-4 w-4 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-30" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-danger" />
          </span>
          <span className="flex-1 text-sm font-mono font-semibold text-fg">
            {formatTimer(elapsed)}
          </span>
          <span className={warn ? 'text-danger text-sm font-mono' : 'text-subtle text-sm font-mono'}>
            -{formatTimer(remaining)}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-surface-2">
          <div
            className="h-1.5 rounded-full bg-danger transition-all duration-1000"
            style={{ width: `${pct}%` }}
          />
        </div>
        <Button variant="danger" size="lg" fullWidth onClick={() => stopRecording(false)} leadingIcon={<StopIcon className="h-5 w-5" />}>
          Stop recording
        </Button>
      </div>
    )
  }

  // ---- UPLOADING -------------------------------------------------------
  if (phase === 'uploading') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-6">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-rule-strong border-t-brand" aria-hidden />
        <p className="text-sm font-medium text-fg">Saving recording…</p>
        <p className="text-xs text-muted">Uploading to the server. It will be transcribed automatically.</p>
      </div>
    )
  }

  // ---- DONE ------------------------------------------------------------
  if (phase === 'done') {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-success/40 bg-tint-success px-4 py-4">
        <p className="text-sm font-semibold text-success">Recording saved</p>
        <p className="text-xs text-muted">
          It will be transcribed and land in the review queue shortly.
        </p>
      </div>
    )
  }

  // ---- ERROR -----------------------------------------------------------
  if (phase === 'error') {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-danger/40 bg-tint-danger px-4 py-4">
        <p className="text-sm font-medium text-danger">{error}</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="md" onClick={() => { setError(null); setPhase('prompt') }}>
            Try again
          </Button>
          <Button variant="ghost" size="md" onClick={() => setPhase('hidden')}>
            Dismiss
          </Button>
        </div>
      </div>
    )
  }

  return null
}

function formatTimer(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
