'use server'

import { createClient } from '@/lib/supabase/server'

export type MatchInput = {
  /** Absolute path of the detected recording file */
  filePath: string
  /** File size in bytes */
  fileSize: number
  /** File mtime as epoch ms */
  fileMtime: number
  /** File duration in seconds, or null if unknown */
  durationSec: number | null
}

export type MatchResult =
  | { kind: 'matched'; callAttemptId: string; groupId: string; eventId: string }
  | { kind: 'unmatched'; reason: string }
  | { kind: 'error'; message: string }

/**
 * Match a detected recording file to an in-app call attempt by timestamp window.
 *
 * Matching rule, in priority order:
 * 1. Primary: the file mtime must fall within [call_started_at, call_started_at + 120s].
 *    The dialer writes the file at hangup, so mtime lands near the end of the call.
 * 2. If exactly one candidate → match.
 * 3. Zero candidates → unmatched.
 * 4. Multiple candidates → try filename as tiebreaker: extract any 10-digit sequence
 *    from the filename, normalise, and compare against guest_groups.primary_mobile.
 *    If exactly one matches → matched. Otherwise → unmatched.
 *
 * Before running, the caller should filter to files whose ledger status is 'seen'
 * and whose mtime is within a reasonable window (e.g. last 30 minutes).
 *
 * The caller must also provide the event_id to scope the search.
 */
export async function matchRecording(
  input: MatchInput & { eventId: string }
): Promise<MatchResult> {
  const supabase = await createClient()

  // 1. Find candidate calls: the recording's mtime must be within
  //    [started_at, started_at + 120s]. We widen slightly to be safe —
  //    the mtime is from the filesystem, which may lag.
  const windowStart = new Date(input.fileMtime - 180_000).toISOString() // 3 min before
  const windowEnd = new Date(input.fileMtime + 120_000).toISOString()   // 2 min after

  const { data: candidates, error: queryErr } = await supabase
    .from('call_attempts')
    .select('id, group_id, dialed_number, started_at, outcome')
    .eq('event_id', input.eventId)
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd)
    .order('started_at', { ascending: false })

  if (queryErr) {
    return { kind: 'error', message: `Could not read call log: ${queryErr.message}` }
  }

  if (!candidates || candidates.length === 0) {
    return { kind: 'unmatched', reason: 'No call attempts found within the time window.' }
  }

  // 2. Further narrow: the mtime must be within [started_at, started_at + 120s]
  const mtimeMs = input.fileMtime
  const matching = candidates.filter((c) => {
    const startMs = new Date(c.started_at).getTime()
    return mtimeMs >= startMs - 5000 && mtimeMs <= startMs + 125_000
  })

  // 3. Exactly one → match
  if (matching.length === 1) {
    const c = matching[0]
    return {
      kind: 'matched',
      callAttemptId: c.id,
      groupId: c.group_id,
      eventId: input.eventId,
    }
  }

  // 4. Zero candidates → unmatched
  if (matching.length === 0) {
    return {
      kind: 'unmatched',
      reason: `File mtime ${new Date(mtimeMs).toISOString()} does not fall within any call window.`,
    }
  }

  // 5. Multiple candidates → filename tiebreaker
  const phone = extractPhoneFromFilename(input.filePath)
  if (!phone) {
    return {
      kind: 'unmatched',
      reason: `Multiple calls (${matching.length}) in the window and filename contains no phone number to break the tie.`,
    }
  }

  const phoneNormalised = normalisePhone(phone)
  if (!phoneNormalised) {
    return {
      kind: 'unmatched',
      reason: `Filename contains a number but it does not normalise to a valid phone.`,
    }
  }

  // Look up which candidate call's guest group matches this phone
  const groupIds = [...new Set(matching.map((c) => c.group_id))]
  const { data: groups } = await supabase
    .from('guest_groups')
    .select('id, primary_mobile')
    .eq('event_id', input.eventId)
    .in('id', groupIds)

  if (!groups) {
    return { kind: 'unmatched', reason: 'Could not look up guest groups for tiebreaker.' }
  }

  const matchedGroup = groups.find(
    (g) => normalisePhone(g.primary_mobile) === phoneNormalised,
  )

  if (!matchedGroup) {
    return {
      kind: 'unmatched',
      reason: `Filename phone number ${phoneNormalised} did not match any of the candidate calls' guest numbers.`,
    }
  }

  const matchedCall = matching.find((c) => c.group_id === matchedGroup.id)
  if (!matchedCall) {
    return { kind: 'unmatched', reason: 'Phone matched a group but not a call in the window.' }
  }

  return {
    kind: 'matched',
    callAttemptId: matchedCall.id,
    groupId: matchedCall.group_id,
    eventId: input.eventId,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a 10-digit sequence from a filename. Handles typical OEM formats:
 *   +919876543210_20240810_143022.m4a
 *   Call_9876543210_2024-08-10.mp3
 *   Record_00919876543210.amr
 */
function extractPhoneFromFilename(filePath: string): string | null {
  const name = filePath.split('/').pop() ?? filePath
  // Strip common prefixes/suffixes, look for 10+ digit sequences.
  const stripped = name.replace(/\.\w{2,4}$/, '') // extension
  const match = /(\d{10,13})/.exec(stripped)
  return match ? match[1] : null
}

/**
 * Normalise an Indian mobile number by stripping +91, spaces, dashes,
 * leading 0, and taking the last 10 digits.
 */
function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = raw.replace(/[^\d]/g, '')
  // Strip +91 prefix
  if (digits.startsWith('91') && digits.length >= 12) digits = digits.slice(2)
  // Take last 10
  if (digits.length >= 10) digits = digits.slice(-10)
  if (digits.length === 10 && /^\d{10}$/.test(digits)) return digits
  return null
}
