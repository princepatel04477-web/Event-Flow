'use client'

/**
 * Voice-note capture, native-first.
 *
 * WHY A NATIVE PLUGIN AND NOT `MediaRecorder`
 *
 * The web path needs `getUserMedia`, and in this app that fails for two
 * independent reasons that both look like "the button is broken":
 *
 *   1. Capacitor's `BridgeWebChromeClient.onPermissionRequest()` asks for
 *      RECORD_AUDIO *and* MODIFY_AUDIO_SETTINGS and ANDs the results. Until
 *      the manifest declared both, the bridge always called `request.deny()`.
 *   2. `getUserMedia` requires a secure context. `npm run mobile:dev` serves
 *      `http://<LAN_IP>:3000`, so `navigator.mediaDevices` is `undefined`
 *      there — the recorder could never be tested on a handset the normal way.
 *
 * `capacitor-voice-recorder` goes straight to Android's `MediaRecorder` over
 * the bridge, so neither applies: it works on the dev LAN URL and on the
 * deployed https build alike.
 *
 * AUDIO SOURCE IS `MIC`, DELIBERATELY. The plugin hardcodes
 * `MediaRecorder.AudioSource.MIC` (verified in its
 * `CustomMediaRecorder.java`). This records the staff member's spoken summary
 * AFTER the call ends. It is NOT call capture — API 30+ blocks third-party
 * capture of call audio, and VOICE_CALL/VOICE_COMMUNICATION would fail on the
 * handsets. Do not "upgrade" the source.
 *
 * THE MIME TYPE IS NOT COSMETIC. The previous implementation recorded
 * webm/opus and uploaded it as `.m4a` with `contentType: 'audio/mp4'`.
 * Sarvam receives the file named by its storage path, so a mislabelled file
 * is handed to the STT API as a format it is not. Every path here reports the
 * container it actually produced.
 */

import { isNativePlatform } from './platform'

export type PermissionState =
  /** Recording is possible right now. */
  | 'granted'
  /** The OS will ask when we start. */
  | 'prompt'
  /** Refused. On Android this may be a permanent "don't ask again". */
  | 'denied'
  /** No microphone, or no recording API on this platform. */
  | 'unsupported'

export interface RecorderCapability {
  permission: PermissionState
  /** Native plugin vs browser MediaRecorder. Drives the copy shown on denial. */
  native: boolean
  /**
   * True only where we can read live amplitude. The native plugin exposes no
   * amplitude API, so the meter is web-only and the UI shows a recording
   * pulse instead — rather than animating a fake level.
   */
  supportsLevel: boolean
  /** Present when `permission` is 'unsupported'; explains why, for the user. */
  reason?: string
}

export interface RecordedAudio {
  blob: Blob
  /** The real content type of `blob`. */
  mimeType: string
  /** File extension matching `mimeType`, no leading dot. */
  extension: string
  durationSec: number
}

// ---------------------------------------------------------------------------
// Format mapping
// ---------------------------------------------------------------------------

/** Extension for a container, derived from the mime type the encoder reported. */
function extensionFor(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  switch (base) {
    case 'audio/aac':
    case 'audio/aacp':
      return 'aac'
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a'
    case 'audio/mpeg':
      return 'mp3'
    case 'audio/ogg':
      return 'ogg'
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav'
    case 'audio/webm':
      return 'webm'
    default:
      // Never guess a container we did not produce. An unknown type keeps a
      // neutral extension so nothing downstream is told a comfortable lie.
      return 'bin'
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

// ---------------------------------------------------------------------------
// Native plugin access
// ---------------------------------------------------------------------------

async function nativeRecorder() {
  const { VoiceRecorder } = await import('capacitor-voice-recorder')
  return VoiceRecorder
}

// ---------------------------------------------------------------------------
// Capability + permission
// ---------------------------------------------------------------------------

/**
 * What can this device do, right now, without prompting anyone.
 *
 * Deliberately never triggers a permission dialog: the control must be able
 * to render itself disabled-with-a-reason before the staff member taps it.
 * Prompting happens in `requestPermission()`, at first use.
 */
export async function getCapability(): Promise<RecorderCapability> {
  if (isNativePlatform()) {
    try {
      const recorder = await nativeRecorder()
      const canRecord = await recorder.canDeviceVoiceRecord()
      if (!canRecord.value) {
        return {
          permission: 'unsupported',
          native: true,
          supportsLevel: false,
          reason: 'This phone reports no usable microphone.',
        }
      }
      const has = await recorder.hasAudioRecordingPermission()
      return {
        permission: has.value ? 'granted' : 'prompt',
        native: true,
        supportsLevel: false,
      }
    } catch (err) {
      // The plugin is missing from this APK — almost always an APK built
      // before the plugin was added. Say that, rather than "unknown error":
      // the fix is a reinstall, not a retry.
      return {
        permission: 'unsupported',
        native: true,
        supportsLevel: false,
        reason:
          'This app build has no recorder. Reinstall the latest APK from the install page, then try again. ' +
          `(${err instanceof Error ? err.message : 'plugin unavailable'})`,
      }
    }
  }

  // --- Web ---------------------------------------------------------------
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      permission: 'unsupported',
      native: false,
      supportsLevel: false,
      reason:
        typeof window !== 'undefined' && !window.isSecureContext
          ? 'Recording needs a secure (https) connection. This page is not on one.'
          : 'This browser cannot record audio.',
    }
  }
  if (typeof MediaRecorder === 'undefined') {
    return {
      permission: 'unsupported',
      native: false,
      supportsLevel: false,
      reason: 'This browser cannot record audio.',
    }
  }

  // The Permissions API is not implemented for 'microphone' everywhere. When
  // it is missing we report 'prompt' — the honest answer is "ask and find
  // out", not "denied".
  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    })
    const state: PermissionState =
      status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt'
    return { permission: state, native: false, supportsLevel: true }
  } catch {
    return { permission: 'prompt', native: false, supportsLevel: true }
  }
}

/** Ask for the microphone. Called at first use, never at app launch. */
export async function requestPermission(): Promise<PermissionState> {
  if (isNativePlatform()) {
    try {
      const recorder = await nativeRecorder()
      const result = await recorder.requestAudioRecordingPermission()
      return result.value ? 'granted' : 'denied'
    } catch {
      return 'unsupported'
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // Immediately release it — this call exists only to resolve the prompt.
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') return 'denied'
    return 'unsupported'
  }
}

// ---------------------------------------------------------------------------
// Recording session
// ---------------------------------------------------------------------------

export interface RecordingSession {
  /** Resolves with the captured audio. Safe to call once. */
  stop(): Promise<RecordedAudio>
  /** Abandon the capture and release the microphone. Discards the audio. */
  cancel(): Promise<void>
  /** 0..1 instantaneous level, or null where the platform cannot report it. */
  level(): number | null
}

/**
 * Begin capturing. The caller owns the returned session and MUST call `stop()`
 * or `cancel()` — both release the microphone. Leaving a session open holds
 * the mic and, on Android, shows a persistent recording indicator.
 */
export async function startRecording(): Promise<RecordingSession> {
  if (isNativePlatform()) return startNativeRecording()
  return startWebRecording()
}

async function startNativeRecording(): Promise<RecordingSession> {
  const recorder = await nativeRecorder()
  const started = await recorder.startRecording()
  if (!started.value) {
    throw new Error('The recorder did not start. Another app may be holding the microphone.')
  }

  let finished = false

  return {
    async stop(): Promise<RecordedAudio> {
      finished = true
      const result = await recorder.stopRecording()
      const value = result.value
      const mimeType = value.mimeType || 'audio/aac'
      if (!value.recordDataBase64) {
        throw new Error('The recording came back empty.')
      }
      return {
        blob: base64ToBlob(value.recordDataBase64, mimeType),
        mimeType,
        extension: extensionFor(mimeType),
        durationSec: Math.max(0, Math.round((value.msDuration ?? 0) / 1000)),
      }
    },
    async cancel(): Promise<void> {
      if (finished) return
      finished = true
      // stopRecording is the only way to release the mic; the result is dropped.
      try {
        await recorder.stopRecording()
      } catch {
        // Already stopped, or never really started. Nothing to release.
      }
    },
    level: () => null,
  }
}

async function startWebRecording(): Promise<RecordingSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

  // Let the browser pick the container it actually supports, then record what
  // it reports — rather than asserting a type it may silently ignore.
  const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 64000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  // --- Level metering -----------------------------------------------------
  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let levelBuffer: Uint8Array | null = null
  try {
    audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 512
    levelBuffer = new Uint8Array(analyser.frequencyBinCount)
    source.connect(analyser)
  } catch {
    // Metering is a nicety. Losing it must never lose the recording.
    audioContext = null
    analyser = null
  }

  const startedAt = Date.now()
  recorder.start()

  function release() {
    stream.getTracks().forEach((t) => t.stop())
    if (audioContext) void audioContext.close().catch(() => {})
    audioContext = null
    analyser = null
  }

  let settled = false

  return {
    stop(): Promise<RecordedAudio> {
      settled = true
      return new Promise<RecordedAudio>((resolve, reject) => {
        recorder.onstop = () => {
          const mimeType = recorder.mimeType || chunks[0]?.type || 'audio/webm'
          release()
          const blob = new Blob(chunks, { type: mimeType })
          if (blob.size === 0) {
            reject(new Error('The recording came back empty.'))
            return
          }
          resolve({
            blob,
            mimeType,
            extension: extensionFor(mimeType),
            durationSec: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
          })
        }
        recorder.onerror = () => {
          release()
          reject(new Error('The recorder failed part-way through.'))
        }
        if (recorder.state !== 'inactive') recorder.stop()
        else recorder.onstop?.(new Event('stop'))
      })
    },
    async cancel(): Promise<void> {
      if (settled) return
      settled = true
      if (recorder.state !== 'inactive') {
        recorder.onstop = () => release()
        recorder.stop()
      } else {
        release()
      }
    },
    level(): number | null {
      if (!analyser || !levelBuffer) return null
      // `getByteTimeDomainData` types as Uint8Array<ArrayBuffer>; the buffer we
      // allocate satisfies that at runtime.
      analyser.getByteTimeDomainData(levelBuffer as Uint8Array<ArrayBuffer>)
      // RMS around the 128 midpoint, scaled so normal speech lands mid-meter.
      let sum = 0
      for (let i = 0; i < levelBuffer.length; i += 1) {
        const deviation = (levelBuffer[i]! - 128) / 128
        sum += deviation * deviation
      }
      const rms = Math.sqrt(sum / levelBuffer.length)
      return Math.min(1, rms * 3)
    },
  }
}
