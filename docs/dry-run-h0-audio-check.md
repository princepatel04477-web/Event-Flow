# Dry Run — H0 Handset Audio Checklist

This is a **DATA TRUST gate**, not a build gate. If both sides of a call are
not audible in the recording, that harvested audio must not feed extraction.

Run this on **each team handset** before the dry run.

## Why this matters

A recording that captures only the staff member (caller) side, or only the
guest side, produces a one-sided transcript. Extraction then fabricates
"confirmed / declined / pax" facts from half a conversation. Both channels
must be audible, or the recording is not usable as evidence.

## Per-handset pass criteria

- Caller (staff) audio: **AUDIBLE** — you hear the team member clearly.
- Guest audio: **AUDIBLE** — you hear the person on the other end clearly.
- Both sides recorded **in the same file**, in order.
- Playback is intelligible at normal volume.

---

## Checklist

| Field | Value |
| --- | --- |
| Handset model | |
| OS + version | |
| Dialer used | |
| Recording file path / name | |
| Tester name | |
| Timestamp | |

### Steps

1. On the handset, sign in and open a call screen.
2. Place a **real call** to a test number, not a simulated one.
3. Speak a known phrase into the handset (caller side), e.g. "Caller check one."
4. Ask the guest/other line to speak a known phrase, e.g. "Guest check two."
5. End the call and complete the outcome so the recording is harvested.
6. Locate the recording file.

### Where the recording lands

- Supabase Storage bucket: **`call-recordings`**
- Database row: **`call_recordings`** (the transcript pipeline reads this row)

Find the file in the Supabase dashboard under **Storage → call-recordings**, or
via the app's recorded-call list on the family screen.

### How to play it back

- In the app: open the voice-note/recording review screen and use the built-in
  `<audio>` player.
- From the bucket: download the file and play it in any media player.

### Results

| Check | Pass / Fail |
| --- | --- |
| Caller (staff) audio | |
| Guest audio | |
| Both in one file, in order | |
| Playback intelligible | |

## Gate decision

- **PASS** — both caller and guest audio audible. Recording may feed extraction.
- **FAIL** — either side missing/inaudible. Do **not** allow this handset's
  harvested audio into extraction until re-tested and passing.
