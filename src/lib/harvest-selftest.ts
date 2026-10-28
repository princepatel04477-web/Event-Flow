'use client'

/**
 * Does automatic call capture work on THIS handset?
 *
 * WHY A TEST AND NOT A LIST OF SUPPORTED PHONES
 *
 * Every step of capture is device-dependent in a way no amount of reading can
 * settle: whether the OEM dialer records at all (Android 13+ blocks
 * third-party capture, and several OEMs ship their own recorder that is
 * exempt), which folder it writes to, what it names the file, and whether
 * All-files access can even be granted. A phone either does these things or it
 * does not, and the only honest way to find out is on the phone.
 *
 * So this runs the REAL path — the same plugin calls, the same file read, the
 * same matcher the sweep uses — and stops one step short of uploading. A green
 * result means capture will work on this device, not that it should.
 *
 * It deliberately does NOT upload. A diagnostic that files a
 * `call_recordings` row would be writing to a table with `no_update` and
 * `no_delete` triggers, i.e. leaving permanent rows behind every time someone
 * taps "test".
 */

import { matchRecording } from '@/lib/harvest-match'
import { contentTypeFor, extensionOf } from '@/lib/harvest-upload'
import {
  discoverFolders,
  getDuration,
  hasPermission,
  isHarvestAvailable,
  listFiles,
  type RecordingFile,
} from '@/lib/harvest'

export type StepState = 'pass' | 'fail' | 'warn' | 'skip'

export interface SelfTestStep {
  id: string
  title: string
  state: StepState
  /** What was actually observed. Shown verbatim — this is the diagnostic. */
  detail: string
  /** What to do about it, when there is something to do. */
  fix?: string
}

export interface SelfTestReport {
  verdict: 'ready' | 'blocked' | 'unknown'
  steps: SelfTestStep[]
  /** Everything the folders hold, newest first — the raw evidence. */
  files: RecordingFile[]
}

/** Read one file through the same path the uploader uses. */
async function canReadFile(path: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const { Filesystem } = await import('@capacitor/filesystem')
    const uri = path.startsWith('file://') ? path : `file://${path}`
    const { data } = await Filesystem.readFile({ path: uri })
    const size = typeof data === 'string' ? Math.floor((data.length * 3) / 4) : -1
    return {
      ok: true,
      detail:
        size >= 0
          ? `Read ${size.toLocaleString()} bytes.`
          : 'Read the file (the platform returned it as a blob).',
    }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'read failed' }
  }
}

export async function runHarvestSelfTest(eventId: string): Promise<SelfTestReport> {
  const steps: SelfTestStep[] = []
  const push = (s: SelfTestStep) => steps.push(s)

  // 1. Is this the APK at all?
  if (!isHarvestAvailable()) {
    push({
      id: 'native',
      title: 'Running inside the app',
      state: 'fail',
      detail: 'This is a browser, not the EventFlow app.',
      fix: 'Open this screen from the installed app. Capture cannot work in a browser tab.',
    })
    return { verdict: 'blocked', steps, files: [] }
  }
  push({
    id: 'native',
    title: 'Running inside the app',
    state: 'pass',
    detail: 'The native bridge is present.',
  })

  // 2. All-files access.
  const granted = await hasPermission()
  push({
    id: 'permission',
    title: 'Permission to read recordings',
    state: granted ? 'pass' : 'fail',
    detail: granted ? 'All-files access is granted.' : 'All-files access is not granted.',
    fix: granted
      ? undefined
      : 'Tap "Allow access to recordings" on the calling screen, or Settings › Apps › EventFlow › Permissions › All files access.',
  })
  if (!granted) return { verdict: 'blocked', steps, files: [] }

  // 3. Does a recordings folder exist? This is where most phones diverge.
  const folders = await discoverFolders()
  push({
    id: 'folders',
    title: 'Call-recording folder',
    state: folders.length > 0 ? 'pass' : 'fail',
    detail:
      folders.length > 0
        ? folders.join('\n')
        : 'No known call-recording folder exists on this phone.',
    fix:
      folders.length > 0
        ? undefined
        : 'Turn on call recording in the phone’s dialer, make one short call, then run this again. ' +
          'If the dialer has no recording option, this handset cannot capture calls and the staff member should record a voice note after the call instead.',
  })
  if (folders.length === 0) return { verdict: 'blocked', steps, files: [] }

  // 4. Is there anything in them?
  const files: RecordingFile[] = []
  for (const folder of folders) files.push(...(await listFiles(folder)))
  files.sort((a, b) => b.mtime - a.mtime)

  push({
    id: 'files',
    title: 'Recordings on this phone',
    state: files.length > 0 ? 'pass' : 'warn',
    detail:
      files.length > 0
        ? `${files.length} file${files.length === 1 ? '' : 's'}. Newest: ${files[0].name}`
        : 'The folder exists but holds no recordings.',
    fix: files.length > 0 ? undefined : 'Make one short call with recording on, then run this again.',
  })
  if (files.length === 0) return { verdict: 'unknown', steps, files }

  const newest = files[0]

  // 5. Is the container one transcription can read?
  const contentType = contentTypeFor(newest.name)
  push({
    id: 'format',
    title: 'Audio format',
    state: contentType ? 'pass' : 'fail',
    detail: contentType
      ? `.${extensionOf(newest.name)} → ${contentType}`
      : `.${extensionOf(newest.name) || '(none)'} is not a container transcription can read.`,
    fix: contentType
      ? undefined
      : 'Change the dialer’s recording format to m4a, aac, mp3 or wav if it offers the choice.',
  })

  // 6. THE UNTESTED ONE. Capacitor Filesystem reading /storage/emulated/0 has
  //    never been exercised in this app; if Android refuses, the fix is a
  //    native readFile and that needs a new APK.
  const read = await canReadFile(newest.path)
  push({
    id: 'read',
    title: 'The app can read the file',
    state: read.ok ? 'pass' : 'fail',
    detail: read.detail,
    fix: read.ok
      ? undefined
      : 'Report this exact message. It is the one failure that needs a new APK rather than a settings change.',
  })

  // 7. Duration — drives the under-10s skip, and a null is tolerated.
  const durationSec = await getDuration(newest.path)
  push({
    id: 'duration',
    title: 'Length of the newest recording',
    state: durationSec === null ? 'warn' : durationSec < 10 ? 'warn' : 'pass',
    detail:
      durationSec === null
        ? 'This phone did not report a duration. Capture still proceeds.'
        : `${durationSec}s`,
    fix:
      durationSec !== null && durationSec < 10
        ? 'Under 10 seconds is skipped on purpose, so a misdial is not billed to transcription. Test with a longer call.'
        : undefined,
  })

  // 8. The real matcher, on the real filename. This is what decides whether a
  //    dialer call can be tied to a family at all.
  const match = await matchRecording({
    filePath: newest.path,
    fileSize: newest.size,
    fileMtime: newest.mtime,
    durationSec,
    eventId,
  })

  push({
    id: 'match',
    title: 'Matching the recording to a family',
    state: match.kind === 'matched' ? 'pass' : match.kind === 'error' ? 'fail' : 'warn',
    detail:
      match.kind === 'matched'
        ? `Matched by ${match.via === 'filename-phone' ? 'the number in the filename' : 'the in-app call log'}.`
        : match.kind === 'error'
          ? match.message
          : match.reason,
    fix:
      match.kind === 'unmatched'
        ? 'The audio would still upload and wait in the unmatched tray. If the filename carries no number, send this screen to the developer — the matcher can be taught this phone’s naming.'
        : undefined,
  })

  const blocked = steps.some((s) => s.state === 'fail')
  return { verdict: blocked ? 'blocked' : 'ready', steps, files }
}
