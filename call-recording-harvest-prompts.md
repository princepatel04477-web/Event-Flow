# Call Recording Harvest — Prompts H0–H6

**Context:** `call_recordings` table is live and has zero producers. Everything downstream
(webhook → `transcribe-recording` → Sarvam → `transcripts` → extraction → `v_review_queue`)
is already deployed and working. These prompts build the producer only.

**Core design decision:** The app cannot record calls (Android blocks `VOICE_CALL` audio source
for non-system apps). Instead it harvests the file the OEM dialer already writes, and matches it
to the in-app call log **by timestamp window**, not by parsing the filename. The app knows exactly
when staff tapped call; that timestamp is far more reliable than per-OEM filename formats.

**Build order is strict.** H0 gates everything. If H0 fails, skip H1–H4 entirely and build H5.

---

## H0 — GATE + DEVICE RECON (no code, ~30 min, human task)

Do this before writing any plugin code. It decides which branch gets built.

**On each team handset (all three, not just yours):**

1. Note make + model + Android version. Settings → About phone.
2. Open the dialer app. Find call recording settings. Turn recording ON.
   Note whether it offers "record all calls automatically" or only manual per-call.
3. Place a real 3-minute call to another person. Talk both ways.
4. End the call. **Play the recording back.**
   - Do you hear the other person clearly, or only yourself?
5. Open a file manager. Find the recording file. Note the **exact folder path**
   and the **exact filename**.

**Fill this in:**

| | Handset 1 | Handset 2 | Handset 3 |
|---|---|---|---|
| Make / model | | | |
| Android version | | | |
| Dialer has recording | | | |
| Auto-record all calls | | | |
| **Both sides audible** | | | |
| Folder path | | | |
| Example filename | | | |

**Decision rule:**

- **All three record both sides** → build H1–H4. Full auto harvest.
- **Mixed, or some record only your voice** → build H5 (voice note). Do not build a
  pipeline that silently produces half-useful audio on some handsets.
- **None record, or recording unavailable** → build H5.

**Consent:** if you proceed with H1–H4, staff must announce recording at the start of every
call — "यह कॉल रिकॉर्ड हो रही है" — before asking anything. `call_recordings.consent_given`
must reflect a real announcement, not a checkbox someone ticked once. Bake the line into the
staff script, not just the UI.

---

## H1 — Capacitor plugin scaffold + all-files permission

```
Create a Capacitor plugin named CallRecordingHarvest in android/app/src/main/java/com/varunya/nuvent/harvest/.

Scope of this prompt: permission flow and folder discovery ONLY. No watching, no upload.

1. Plugin class CallRecordingHarvestPlugin annotated @CapacitorPlugin(name = "CallRecordingHarvest").

2. Method hasPermission(): returns { granted: boolean }.
   Use Environment.isExternalStorageManager() on API 30+.
   On API 29 and below, check READ_EXTERNAL_STORAGE via normal runtime permission.

3. Method requestPermission(): opens
   Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION with Uri.fromParts("package", packageName, null).
   On API 29 and below, fall back to the standard runtime permission request.
   Resolve with the post-return result of isExternalStorageManager().

   Add to AndroidManifest.xml:
     <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />
   This would be rejected by Play Store review. We sideload the APK, so this is acceptable.
   Add a comment in the manifest saying exactly that, so nobody "fixes" it later.

4. Method discoverFolders(): returns { folders: string[] }.
   Probe this list, return only paths that exist and are readable:
     /storage/emulated/0/MIUI/sound_recorder/call_rec
     /storage/emulated/0/Recordings/Call
     /storage/emulated/0/Record/PhoneRecord
     /storage/emulated/0/Sounds/CallRecord
     /storage/emulated/0/PhoneRecord
     /storage/emulated/0/Music/Recordings
     /storage/emulated/0/Android/data/com.google.android.dialer/files/CallRecordings
   Also accept a manual override path stored in Capacitor Preferences under key
   harvest.folderOverride, and probe that first if set.

5. TypeScript wrapper in src/lib/harvest.ts exporting typed calls to all three methods.

6. Add a dev-only screen at /admin/harvest-debug that shows permission state, a request button,
   the discovered folder list, and a raw listing of the newest 20 files in each folder with
   name, size, and modified time.

DEFINITION OF DONE:
Install on a team handset, open /admin/harvest-debug, grant permission, and see the real
call recording folder listed with real recording files in it. Paste the raw listing back to me.

DO NOT: upload anything, insert any DB rows, parse any filenames, or touch call_recordings.
```

---

## H2 — Watch + resume scan + dedupe ledger

```
Extend CallRecordingHarvest to detect new recording files. Detection only — still no upload.

1. FileObserver on each discovered folder, constructed with the File-based constructor
   (the String constructor is deprecated on API 29+).
   Listen for CLOSE_WRITE, not CREATE. CREATE fires while the dialer is still writing and
   would give us a truncated file.
   Hold a strong reference to every observer in a field. FileObserver is garbage collected
   aggressively if you don't, and observation silently stops.

2. FileObserver does not survive process death. Android will kill our WebView constantly.
   So also run a full folder scan:
     - on plugin load
     - on app resume (Capacitor appStateChange handler)
   The scan compares against the ledger below and emits anything unseen.

3. Dedupe ledger. Table in the existing Dexie DB, name it harvest_seen:
     path (primary key), size, mtime, status, callRecordingId, firstSeenAt, lastError
   status: 'seen' | 'matched' | 'uploaded' | 'unmatched' | 'failed'
   A file is new only if its path is absent from the ledger. Never re-emit a known path.
   Store size and mtime so we can detect a file being rewritten in place.

4. Size-stability guard. Even after CLOSE_WRITE, poll the file size once after 2 seconds.
   If it changed, wait and poll again, up to 3 times. Skip the file if it never stabilises
   and log it as status 'failed' with a reason — do not upload a growing file.

5. Emit a Capacitor event 'recordingDetected' with { path, size, mtime, durationSeconds }.
   Get duration with MediaMetadataRetriever. If retrieval fails, emit duration as null rather
   than guessing.

6. Extend /admin/harvest-debug to show the ledger contents and a live log of detected events.

DEFINITION OF DONE:
Place a real call on the handset. Within 10 seconds of hanging up, the debug screen shows a
recordingDetected event with a plausible duration. Kill the app from recents, place another
call, reopen the app — the resume scan picks up the second file and does NOT re-emit the first.

DO NOT: match to any guest, upload, or write to call_recordings.
```

---

## H3 — Match to call log by timestamp window

```
Match detected recordings to the in-app call log. Matching only — still no upload.

We already write a row when staff taps to call a guest group. Find that table and read its
actual schema before writing any code. Do not assume column names. Report what you find
before proceeding.

MATCHING RULE, in priority order:

1. Primary signal is TIME. A recording whose file mtime falls within
   [call_started_at, call_started_at + duration + 120s] is a candidate.
   In practice the dialer writes the file at hangup, so mtime should land near the end of the call.

2. If exactly one candidate call → match. Set ledger status 'matched'.

3. If zero candidates → status 'unmatched'. Do not guess. Do not attach to the nearest call.

4. If more than one candidate (staff called two guests in quick succession) → try the
   filename as a tiebreaker:
     - extract any 10-digit sequence from the filename
     - normalise both it and guest_groups.phone by stripping +91, spaces, dashes, leading 0
     - if exactly one candidate call's guest phone matches, take it
     - otherwise leave status 'unmatched'

   Implement filename number extraction as a single regex over the whole filename. Do NOT write
   per-OEM filename parsers. Some OEMs write the contact name instead of the number and there is
   nothing to extract; that is expected and must degrade to 'unmatched', not to a wrong match.

5. Never mark a recording 'matched' to a call that already has a matched recording.

UNMATCHED TRAY:
Build a screen at /calls/unmatched listing every ledger row with status 'unmatched', showing
file time, duration, and a play button using a local file:// source. Staff picks the correct
guest group from a searchable list to attach it manually. Attaching sets status 'matched'.

An unmatched recording is a normal outcome, not an error. The tray must not look like a failure state.

DEFINITION OF DONE:
Place a call to a guest group in the app, hang up, and see the recording auto-match to that
exact call. Then place a call from the native dialer directly (bypassing the app) and confirm
it lands in the unmatched tray rather than attaching to something wrong.

DO NOT: upload, or write to call_recordings.
```

---

## H4 — Upload + insert row

```
Wire matched recordings through to storage and the call_recordings table.

Read the existing call_recordings schema and the delivery_proofs upload path before writing
anything. Reuse the delivery_proofs pattern for attribution and error handling — do not invent
a second pattern.

1. Storage upload to the existing recordings bucket, path:
     {event_id}/{guest_group_id}/{uuid}.{ext}
   Keep the original file extension. Do not transcode on device.

2. On upload success, insert one call_recordings row:
     storage_path, duration_seconds, consent_given, recorded_by_staff, guest_group_id, call_id
   Attribution follows the split-column rule: exactly one of recorded_by / recorded_by_staff.
   A team session sets recorded_by_staff from the JWT staff_member_id claim.
   If the claim is absent, ABORT the insert and surface a real error. Do not fall back to a
   cookie and do not insert with neither column set — the CHECK will reject it with an opaque
   23514 and we have been burned by exactly this before.

3. consent_given comes from a per-call flag set when staff confirms they announced recording.
   Add that confirmation to the call screen. No confirmation, no upload — hold the file in the
   ledger as 'unmatched' with a reason instead of uploading without consent.

4. Upload queue, not fire-and-forget:
   - only upload on unmetered connection by default, with a "upload now on mobile data" override
     in the debug screen
   - retry with exponential backoff, 5 attempts, then status 'failed' with lastError populated
   - a failed upload must be retryable from the UI
   - never delete the local file, even after successful upload. Storage on the handset is cheap;
     a lost recording is not recoverable.

5. Log SQLSTATE and constraint name to Sentry on any insert failure. Do not swallow it into a
   generic message.

DEFINITION OF DONE:
Place a real call, confirm consent, and watch the row appear in call_recordings with correct
guest_group_id and recorded_by_staff. Then confirm the existing webhook fired and a transcripts
row was created by Sarvam without any further intervention. Paste both rows back to me.

Then verify the failure path: turn off wifi and mobile data, place a call, confirm the ledger
shows a pending upload that completes when connectivity returns.
```

---

## H5 — FALLBACK: post-call voice note

Build this instead of H1–H4 if H0 fails. Also worth building **alongside** H1–H4 as the
manual escape hatch when auto-harvest misses.

```
Add a post-call voice note recorder. This does not touch the call audio at all — staff
summarises the call out loud immediately after hanging up.

1. On returning to the app after a call, show a prompt: "Record what the guest said?"
   with a large record button. Dismissible.

2. Record with MediaRecorder, audio source MIC, AAC in an .m4a container, 22.05kHz mono,
   32kbps. No special permissions beyond RECORD_AUDIO.

3. Max 3 minutes with a visible countdown. Stop button always available.

4. On stop, upload to the same recordings bucket and insert a call_recordings row with the
   same attribution rules as H4. guest_group_id and call_id come from the call that just
   happened — this is unambiguous because we prompted immediately after it.

5. Add a source column distinguishing 'harvested' from 'voice_note' if one does not already
   exist, so extraction can weight them differently. A voice note is staff paraphrasing; a
   harvested call is the guest's own words. The extraction prompt must know which it is reading.

DEFINITION OF DONE:
Complete a call, record a 60-second summary, confirm the row lands and Sarvam transcribes it.
Compare the transcript quality against a harvested call recording if you have one.
```

---

## H6 — Verification before the dry run

```
Verify the harvest path end to end on the real handsets, not the emulator.

Run this checklist on EACH team handset and report pass/fail per line:

1. Fresh install of the release APK. Permission grant flow completes without a crash.
2. Place a call, hang up. Recording auto-matches within 30 seconds.
3. Row lands in call_recordings with the correct staff attribution.
4. Sarvam transcript appears without manual intervention.
5. Extraction output reaches v_review_queue.
6. Kill the app from recents mid-call. Reopen. The recording is still picked up by resume scan.
7. Airplane mode during a call. Recording queues locally and uploads on reconnect.
8. Call a number with no matching guest group. Lands in the unmatched tray, attaches nothing.
9. Decline the consent confirmation. No upload occurs, file is retained locally.
10. Ten calls in a row. No duplicate rows, no missed files, ledger count matches file count.

Report the results as a table. Do not summarise as "working" — I want the ten lines.
```

---

## Notes

**Storage volume.** 238 families × ~4 min × 32kbps AAC ≈ 230 MB total. Not a concern.
If you harvest at OEM default bitrate it could be 4–5× that; still fine.

**Do not build H1–H4 blind.** If H0 shows mixed handsets, the auto-harvest path will work on
some phones and silently fail on others during a live event, and you will not find out until
the review queue is half empty. H5 works identically on every handset.

**Three days.** H5 is roughly half a day. H1–H4 is two to three days if the handsets are uniform,
and is not worth starting if they are not. The dry run matters more than either.
