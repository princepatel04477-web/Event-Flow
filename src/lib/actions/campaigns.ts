'use server'

import { revalidatePath } from 'next/cache'

import { friendlyDbError, type MaybePostgrestError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/supabase/queries'

export type CampaignWave = 'wave_1' | 'wave_2' | 'wave_3'
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed'
export type JobStatus =
  | 'pending'
  | 'ringing'
  | 'completed'
  | 'no_answer'
  | 'declined'
  | 'failed'
  | 'dnd'
  | 'skipped'
  | 'callback'

export type CampaignRow = {
  id: string
  wave: CampaignWave
  label: string
  scheduledFor: string | null
  status: CampaignStatus
  daysBefore: number
  maxConcurrent: number
  pending: number
  completed: number
  total: number
}

type CampaignDbRow = {
  id: string
  wave: string
  label: string
  scheduled_for: string | null
  status: string
  days_before: number
  max_concurrent: number
}

type JobDbRow = {
  campaign_id: string
  status: string
}

const WAVE_DEFAULTS: { wave: CampaignWave; label: string; daysBefore: number }[] = [
  { wave: 'wave_1', label: 'Round 1 — about one month before', daysBefore: 30 },
  { wave: 'wave_2', label: 'Round 2 — about ten days before', daysBefore: 10 },
  { wave: 'wave_3', label: 'Round 3 — about two days before', daysBefore: 2 },
]

export type CampaignActionResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * `ensureCampaigns` reads AND, on a brand-new event, writes — so a failure is
 * not an empty event. Returning `[]` for a refused read or a refused insert
 * made the board render no round card at all, with no message and no way to
 * create one. The page turns `{ ok: false }` into the error face with a retry.
 */
export type CampaignsResult =
  | { ok: true; campaigns: CampaignRow[] }
  | { ok: false; error: string }

async function assertManagement(eventId: string, eventCode: string) {
  await requireStaff(eventId, eventCode)
}

/** Ensure three campaign rows exist for the event. */
export async function ensureCampaigns(
  eventId: string,
  eventCode: string,
  weddingDate: string | null,
): Promise<CampaignsResult> {
  await assertManagement(eventId, eventCode)
  const supabase = await createClient()

  const { data: existing, error: existingError } = await supabase
    .from('rsvp_campaigns')
    .select('id')
    .eq('event_id', eventId)

  if (existingError) return { ok: false, error: friendlyDbError(existingError) }

  if (!existing?.length) {
    const startsOn = weddingDate ? new Date(weddingDate) : null
    const rows = WAVE_DEFAULTS.map((w) => {
      let scheduledFor: string | null = null
      if (startsOn && !Number.isNaN(startsOn.getTime())) {
        const d = new Date(startsOn)
        d.setDate(d.getDate() - w.daysBefore)
        scheduledFor = d.toISOString().slice(0, 10)
      }
      return {
        event_id: eventId,
        wave: w.wave,
        label: w.label,
        days_before: w.daysBefore,
        scheduled_for: scheduledFor,
        status: 'draft' as CampaignStatus,
      }
    })
    const { error: insertError } = await supabase.from('rsvp_campaigns').insert(rows)
    // This error used to be ignored: the insert failed, the function returned
    // [], and the screen rendered nothing at all — no "Start calling", no
    // explanation, no way for a lead to create the rounds.
    if (insertError) return { ok: false, error: friendlyDbError(insertError) }
  }

  const { data: campaigns, error: campaignsError } = (await supabase
    .from('rsvp_campaigns')
    .select('id, wave, label, scheduled_for, status, days_before, max_concurrent')
    .eq('event_id', eventId)
    .order('days_before', { ascending: false })) as unknown as {
    data: CampaignDbRow[] | null
    error: MaybePostgrestError
  }

  if (campaignsError) return { ok: false, error: friendlyDbError(campaignsError) }

  if (!campaigns?.length) return { ok: true, campaigns: [] }

  const campaignIds = campaigns.map((c) => c.id)
  const { data: jobs, error: jobsError } = (await supabase
    .from('rsvp_campaign_jobs')
    .select('campaign_id, status')
    .in('campaign_id', campaignIds)) as unknown as {
    data: JobDbRow[] | null
    error: MaybePostgrestError
  }

  if (jobsError) return { ok: false, error: friendlyDbError(jobsError) }

  const counts = new Map<string, { pending: number; completed: number; total: number }>()
  for (const id of campaignIds) {
    counts.set(id, { pending: 0, completed: 0, total: 0 })
  }
  for (const j of jobs ?? []) {
    const c = counts.get(j.campaign_id)!
    c.total += 1
    if (j.status === 'completed') c.completed += 1
    else if (j.status === 'pending' || j.status === 'ringing' || j.status === 'callback') {
      c.pending += 1
    }
  }

  // There used to be a `revalidatePath(`/${eventCode}/rsvp/campaigns`)` here.
  // It is gone on purpose, and it is not a tidy-up: this function has exactly
  // one caller, `(staff)/[eventCode]/rsvp/campaigns/page.tsx`, which calls it
  // during a server render — and since Next 16 `revalidatePath` during a render
  // is unsupported. It does not warn, it throws, and the whole screen is
  // replaced by the error boundary. Measured: "Route /[eventCode]/rsvp/campaigns
  // used `revalidatePath` during render which is unsupported", on v1 as well as
  // v2, because the flag has nothing to do with it. It matters more than one
  // screen: `departmentHomePath('management')` is this path, so every event lead
  // landed on a dead app.
  //
  // Nothing replaces it, and nothing needs to. The only write above is the
  // insert of the default rows when the event has none, and the reads that
  // follow it are part of the same render — so the page already shows the rows
  // it just created. The two `revalidatePath` calls that remain in this file are
  // in server-action bodies, where revalidating is both legal and wanted.
  return {
    ok: true,
    campaigns: campaigns.map((c) => {
      const n = counts.get(c.id) ?? { pending: 0, completed: 0, total: 0 }
      return {
        id: c.id,
        wave: c.wave as CampaignWave,
        label: c.label,
        scheduledFor: c.scheduled_for,
        status: c.status as CampaignStatus,
        daysBefore: c.days_before,
        maxConcurrent: c.max_concurrent,
        pending: n.pending,
        completed: n.completed,
        total: n.total,
      }
    }),
  }
}

/** Populate jobs for a campaign from guest groups not yet confirmed. */
export async function populateCampaignJobs(
  campaignId: string,
  eventId: string,
  eventCode: string,
): Promise<CampaignActionResult> {
  await assertManagement(eventId, eventCode)
  const supabase = await createClient()

  const { data: groups } = await supabase
    .from('guest_groups')
    .select('id')
    .eq('event_id', eventId)
    .in('rsvp_status', ['not_started', 'attempted', 'callback', 'tentative', 'unreachable'])

  if (!groups?.length) {
    return { ok: false, error: 'No families left to call for this wave.' }
  }

  const rows = groups.map((g) => ({
    campaign_id: campaignId,
    event_id: eventId,
    group_id: g.id,
    status: 'pending' as JobStatus,
  }))

  const { error } = await supabase
    .from('rsvp_campaign_jobs')
    .upsert(rows, { onConflict: 'campaign_id,group_id', ignoreDuplicates: true })

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/${eventCode}/rsvp/campaigns`)
  return { ok: true }
}

export async function setCampaignStatus(
  campaignId: string,
  eventId: string,
  eventCode: string,
  status: CampaignStatus,
): Promise<CampaignActionResult> {
  await assertManagement(eventId, eventCode)
  const supabase = await createClient()

  const { error } = await supabase
    .from('rsvp_campaigns')
    .update({ status })
    .eq('id', campaignId)
    .eq('event_id', eventId)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/${eventCode}/rsvp/campaigns`)
  return { ok: true }
}

export async function startCampaign(
  campaignId: string,
  eventId: string,
  eventCode: string,
): Promise<CampaignActionResult> {
  const pop = await populateCampaignJobs(campaignId, eventId, eventCode)
  if (!pop.ok) return pop
  return setCampaignStatus(campaignId, eventId, eventCode, 'running')
}
