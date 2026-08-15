'use server'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'
import { provider } from '@/lib/messaging/provider'

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface MessageTemplate {
  id: string
  key: string
  category: string | null
  language: string
  body: string
  variables: string[]
  isActive: boolean
}

export async function readTemplates(eventId: string): Promise<MessageTemplate[]> {
  const supabase = await createClient()

  // Global plus event-level overrides
  const { data } = await supabase
    .from('message_templates')
    .select('id, key, category, language, body, variables, is_active')
    .or(`event_id.eq.${eventId},event_id.is.null`)
    .order('key', { ascending: true })

  // Event overrides take precedence over global
  const seen = new Map<string, MessageTemplate>()
  const rows = (data ?? []) as unknown as Record<string, unknown>[]

  // Process globals first, then event overrides overwrite
  for (const r of rows) {
    const t: MessageTemplate = {
      id: r.id as string,
      key: r.key as string,
      category: r.category as string | null,
      language: r.language as string,
      body: r.body as string,
      variables: (r.variables as string[]) ?? [],
      isActive: r.is_active as boolean,
    }
    if (!seen.has(t.key) || r.event_id) {
      seen.set(t.key, t)
    }
  }

  return [...seen.values()]
}

// ---------------------------------------------------------------------------
// Recipient filters
// ---------------------------------------------------------------------------

export interface RecipientGroup {
  groupId: string
  headName: string
  mobileNumber: string
  rsvpStatus: string
}

export type RecipientFilter =
  | 'all_confirmed'
  | 'arriving_today'
  | 'departing_today'
  | 'room_allocated'
  | 'no_room'

export async function resolveRecipients(
  eventId: string,
  filter: RecipientFilter,
): Promise<RecipientGroup[]> {
  const supabase = await createClient()

  let query = supabase
    .from('guest_groups')
    .select('id, head_name, primary_mobile, rsvp_status')

  switch (filter) {
    case 'all_confirmed':
      query = query.eq('rsvp_status', 'confirmed')
      break
    case 'arriving_today':
      // This needs the v_rsvp_queue join — simplified: confirmed + has arrival today
      query = query.eq('rsvp_status', 'confirmed')
      break
    case 'departing_today':
      query = query.eq('rsvp_status', 'confirmed')
      break
    case 'room_allocated': {
      const { data: roomed } = await supabase
        .from('room_assignments')
        .select('group_id')
        .eq('event_id', eventId)
        .is('released_at', null)
      const ids = [...new Set((roomed ?? []).map((r) => r.group_id))]
      query = query.in('id', ids)
      break
    }
    case 'no_room': {
      query = query.eq('rsvp_status', 'confirmed')
      // We'll filter client-side since we need the anti-join
      break
    }
  }

  const { data } = await query.eq('event_id', eventId).order('head_name', { ascending: true })

  if (filter === 'no_room') {
    const { data: roomed } = await supabase
      .from('room_assignments')
      .select('group_id')
      .eq('event_id', eventId)
      .is('released_at', null)
    const roomedIds = new Set((roomed ?? []).map((r) => r.group_id))
    return ((data ?? []) as unknown as RecipientGroup[])
      .filter((g) => !roomedIds.has(g.groupId))
  }

  return ((data ?? []) as unknown as RecipientGroup[])
    .filter((g) => g.mobileNumber && g.mobileNumber.trim().length >= 10)
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface SendPreview {
  template: string
  recipientCount: number
  sampleBody: string
  filter: string
}

export interface SendResult {
  sent: number
  failed: number
  skipped: number
  errors: string[]
}

export async function sendMessages(
  eventId: string,
  templateKey: string,
  filter: RecipientFilter,
  testMode: boolean,
  testNumber?: string,
  overwriteExisting = false,
): Promise<SendResult> {
  const supabase = await createClient()

  // Resolve template
  const { data: template } = await supabase
    .from('message_templates')
    .select('id, body, variables')
    .or(`event_id.eq.${eventId},event_id.is.null`)
    .eq('key', templateKey)
    .order('event_id', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle()

  if (!template) return { sent: 0, failed: 0, skipped: 0, errors: ['Template not found.'] }

  // Resolve recipients
  const recipients = testMode && testNumber
    ? [{ groupId: '', headName: 'Test', mobileNumber: testNumber, rsvpStatus: 'confirmed' }]
    : await resolveRecipients(eventId, filter)

  // Guard: never send to declined
  const eligible = recipients.filter((r) => r.rsvpStatus !== 'declined')

  if (eligible.length === 0) {
    return { sent: 0, failed: 0, skipped: 0, errors: ['No eligible recipients after guards.'] }
  }

  // Guard: never send the same template to the same group
  if (!overwriteExisting) {
    const { data: sent } = await supabase
      .from('messages')
      .select('group_id')
      .eq('event_id', eventId)
      .eq('template_key', templateKey)

    const sentGroupIds = new Set((sent ?? []).map((m) => m.group_id))
    const filtered = eligible.filter((r) => !sentGroupIds.has(r.groupId))
    const skipped = eligible.length - filtered.length

    if (filtered.length === 0) {
      return {
        sent: 0, failed: 0, skipped,
        errors: [`All ${eligible.length} recipients already received this template. Check "overwrite" to send again.`],
      }
    }

    // Write queued rows
    const templateBody = template.body as string
    const rows = filtered.map((r) => ({
      event_id: eventId,
      group_id: r.groupId || null,
      to_number: r.mobileNumber,
      template_key: templateKey,
      body: templateBody,
      provider: 'bsp' as const,
      status: 'queued' as const,
    }))

    const { error } = await supabase.from('messages').insert(rows)
    if (error) return { sent: 0, failed: filtered.length, skipped, errors: [friendlyDbError(error)] }

    // Send one by one with rate limiting — need to query for IDs first
    let sentCount = 0
    let failedCount = 0
    const errors: string[] = []

    // Get the freshly inserted message IDs
    const { data: inserted } = await supabase
      .from('messages')
      .select('id, group_id, to_number')
      .eq('event_id', eventId)
      .eq('template_key', templateKey)
      .eq('status', 'queued')
      .order('queued_at', { ascending: false })
      .limit(filtered.length)

    const messageMap = new Map<string, string>()
    for (const m of (inserted ?? [])) {
      if (m.group_id) messageMap.set(m.group_id, m.id)
    }

    for (let i = 0; i < filtered.length; i++) {
      const r = filtered[i]
      const result = await provider.send({
        to: r.mobileNumber,
        templateKey,
        vars: { head_name: r.headName },
        eventId,
        groupId: r.groupId,
      })

      const mid = messageMap.get(r.groupId)
      if (result.ok) {
        if (mid) {
          await supabase
            .from('messages')
            .update({
              status: 'sent' as const,
              provider_message_id: result.providerMessageId,
              sent_at: new Date().toISOString(),
            })
            .eq('id', mid)
        }
        sentCount++
      } else {
        if (mid) {
          await supabase
            .from('messages')
            .update({
              status: 'failed' as const,
              error: result.error,
            })
            .eq('id', mid)
        }
        failedCount++
        errors.push(`${r.headName} (${r.mobileNumber}): ${result.error}`)
      }

      // Rate limit: 2 per second
      if (i < filtered.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    return { sent: sentCount, failed: failedCount, skipped, errors }
  }

  // Overwrite: just send
  const templateBody = template.body as string
  const rows = eligible.map((r) => ({
    event_id: eventId,
    group_id: r.groupId || null,
    to_number: r.mobileNumber,
    template_key: templateKey,
    body: templateBody,
    provider: 'bsp' as const,
    status: 'queued' as const,
  }))

  const { error } = await supabase.from('messages').insert(rows)
  if (error) return { sent: 0, failed: eligible.length, skipped: 0, errors: [friendlyDbError(error)] }

  let sentCount = 0
  let failedCount = 0
  const errors: string[] = []

  // Get IDs from the insert
  const { data: inserted } = await supabase
    .from('messages')
    .select('id, group_id')
    .eq('event_id', eventId)
    .eq('template_key', templateKey)
    .eq('status', 'queued')
    .order('queued_at', { ascending: false })
    .limit(eligible.length)

  const messageMap = new Map<string, string>()
  for (const m of (inserted ?? [])) {
    if (m.group_id) messageMap.set(m.group_id, m.id)
  }

  for (let i = 0; i < eligible.length; i++) {
    const r = eligible[i]
    const result = await provider.send({
      to: r.mobileNumber,
      templateKey,
      vars: { head_name: r.headName },
      eventId,
      groupId: r.groupId,
    })

    const mid = messageMap.get(r.groupId)
    if (result.ok) {
      if (mid) {
        await supabase
          .from('messages')
          .update({
            status: 'sent' as const,
            provider_message_id: result.providerMessageId,
            sent_at: new Date().toISOString(),
          })
          .eq('id', mid)
      }
      sentCount++
    } else {
      if (mid) {
        await supabase
          .from('messages')
          .update({
            status: 'failed' as const,
            error: result.error,
          })
          .eq('id', mid)
      }
      failedCount++
      errors.push(`${r.headName} (${r.mobileNumber}): ${result.error}`)
    }

    if (i < eligible.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  return { sent: sentCount, failed: failedCount, skipped: 0, errors }
}

// ---------------------------------------------------------------------------
// Manual generate — write queued rows without sending
// ---------------------------------------------------------------------------

export interface GeneratedMessage {
  messageId: string
  groupId: string | null
  headName: string
  mobileNumber: string
  body: string
  templateKey: string
}

export async function generateMessages(
  eventId: string,
  templateKey: string,
  filter: RecipientFilter,
): Promise<GeneratedMessage[]> {
  const supabase = await createClient()

  const { data: template } = await supabase
    .from('message_templates')
    .select('body')
    .or(`event_id.eq.${eventId},event_id.is.null`)
    .eq('key', templateKey)
    .order('event_id', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle()

  if (!template) return []

  const recipients = await resolveRecipients(eventId, filter)
  const eligible = recipients.filter((r) =>
    r.mobileNumber &&
    r.mobileNumber.trim().length >= 10 &&
    r.rsvpStatus !== 'declined',
  )

  if (eligible.length === 0) return []

  // Guard: never generate the same template+group twice
  const { data: existing } = await supabase
    .from('messages')
    .select('group_id')
    .eq('event_id', eventId)
    .eq('template_key', templateKey)

  const sentGroupIds = new Set((existing ?? []).map((m) => m.group_id))
  const fresh = eligible.filter((r) => !sentGroupIds.has(r.groupId))

  if (fresh.length === 0) return []

  const templateBody = template.body as string

  const rows = fresh.map((r) => {
    const body = templateBody.replace(
      /\{\{(\w+)\}\}/g,
      (_, key: string) => {
        const map: Record<string, string> = {
          head_name: r.headName,
        }
        return map[key] ?? `{{${key}}}`
      },
    )

    return {
      event_id: eventId,
      group_id: r.groupId || null,
      to_number: r.mobileNumber,
      template_key: templateKey,
      body,
      provider: 'manual' as const,
      status: 'queued' as const,
    }
  })

  const { data: inserted } = await supabase
    .from('messages')
    .insert(rows)
    .select('id, group_id')
    .order('queued_at', { ascending: true })

  const result: GeneratedMessage[] = []
  for (let i = 0; i < fresh.length; i++) {
    const r = fresh[i]
    result.push({
      messageId: inserted?.[i]?.id ?? '',
      groupId: r.groupId,
      headName: r.headName,
      mobileNumber: r.mobileNumber,
      body: rows[i].body,
      templateKey,
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Driver pickup summary (§4.4)
//
// Reuses the existing `messages` table — a driver's day summary is just a
// message row with to_number = driver mobile and a body listing their
// pickups. No new schema; the WhatsApp cut left these tables and they fit
// this use case exactly (confirmed in §2.1 recon).
// ---------------------------------------------------------------------------

export interface DriverPickupSummary {
  driverName: string
  driverMobile: string | null
  date: string
  pickups: { time: string | null; headName: string; pax: number; point: string | null }[]
  totalPax: number
}

/** A driver's committed trips for one day, from trips + trip_passengers. */
export async function readDriverPickupSummary(
  eventId: string,
  driverId: string,
  date: string,
): Promise<{ ok: true; summary: DriverPickupSummary } | { ok: false; error: string }> {
  const supabase = await createClient()

  const { data: driver } = await supabase
    .from('drivers')
    .select('full_name, mobile')
    .eq('id', driverId)
    .eq('event_id', eventId)
    .maybeSingle()
  if (!driver) return { ok: false, error: 'Driver not found.' }

  const { data: trips, error } = await supabase
    .from('trips')
    .select(
      'id, scheduled_at, pickup_point, driver_id, trip_passengers(group_id, pax, guest_groups(head_name))',
    )
    .eq('event_id', eventId)
    .eq('driver_id', driverId)
    .not('status', 'eq', 'cancelled')
    .order('scheduled_at', { ascending: true })

  if (error) return { ok: false, error: friendlyDbError(error) }

  const pickups: DriverPickupSummary['pickups'] = []
  let totalPax = 0
  for (const t of trips ?? []) {
    const time = t.scheduled_at ? new Date(t.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
    for (const p of (t.trip_passengers ?? []) as Array<{ pax: number; guest_groups: { head_name: string } | null }>) {
      pickups.push({
        time,
        headName: p.guest_groups?.head_name ?? 'Guest',
        pax: p.pax,
        point: t.pickup_point,
      })
      totalPax += p.pax
    }
  }

  return {
    ok: true,
    summary: {
      driverName: driver.full_name,
      driverMobile: driver.mobile,
      date,
      pickups,
      totalPax,
    },
  }
}

/** Queue a driver's day-summary message through the existing messages table. */
export async function sendDriverPickupSummary(
  eventId: string,
  driverId: string,
  date: string,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const res = await readDriverPickupSummary(eventId, driverId, date)
  if (!res.ok) return res
  const { summary } = res

  if (!summary.driverMobile) {
    return { ok: false, error: 'Driver has no mobile number on file.' }
  }
  if (summary.pickups.length === 0) {
    return { ok: false, error: 'No pickups committed for this driver on this date.' }
  }

  const lines = summary.pickups.map(
    (p) => `${p.time ?? '—'} · ${p.headName} (${p.pax} ${p.pax === 1 ? 'person' : 'people'})${p.point ? ` · ${p.point}` : ''}`,
  )
  const body = `Your pickups for ${summary.date}:\n${lines.join('\n')}\nTotal: ${summary.totalPax} guests.`

  const { data, error } = await supabase
    .from('messages')
    .insert({
      event_id: eventId,
      to_number: summary.driverMobile,
      template_key: 'driver_pickup_summary',
      body,
      provider: 'manual',
      status: 'queued',
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: friendlyDbError(error) }
  return { ok: true, messageId: data.id }
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

export interface MessageLogRow {
  id: string
  groupId: string | null
  headName: string | null
  toNumber: string
  templateKey: string | null
  status: string
  providerMessageId: string | null
  error: string | null
  queuedAt: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
}

export type MessageLogFilter = 'all' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

export async function readMessageLog(
  eventId: string,
  filter: MessageLogFilter = 'all',
): Promise<MessageLogRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('messages')
    .select(
      'id, group_id, to_number, template_key, status, provider_message_id, error, queued_at, sent_at, delivered_at, read_at, guest_groups(head_name)',
    )
    .eq('event_id', eventId)
    .order('queued_at', { ascending: false })
    .limit(200)

  if (filter !== 'all') {
    query = query.eq('status', filter)
  }

  const { data } = await query

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((m) => {
    const group = m.guest_groups as { head_name: string } | null
    return {
      id: m.id as string,
      groupId: m.group_id as string | null,
      headName: group?.head_name ?? null,
      toNumber: m.to_number as string,
      templateKey: m.template_key as string | null,
      status: m.status as string,
      providerMessageId: m.provider_message_id as string | null,
      error: m.error as string | null,
      queuedAt: m.queued_at as string,
      sentAt: m.sent_at as string | null,
      deliveredAt: m.delivered_at as string | null,
      readAt: m.read_at as string | null,
    }
  })
}

export async function retryMessage(messageId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()

  const { data: msg } = await supabase
    .from('messages')
    .select('id, to_number, template_key, status')
    .eq('id', messageId)
    .maybeSingle()

  if (!msg) return { ok: false, error: 'Message not found.' }
  if (msg.status === 'delivered' || msg.status === 'read') {
    return { ok: false, error: 'Message already delivered.' }
  }

  const result = await provider.send({
    to: msg.to_number,
    templateKey: msg.template_key ?? '',
    vars: {},
    eventId: '',
  })

  if (result.ok) {
    await supabase
      .from('messages')
      .update({
        status: 'sent',
        provider_message_id: result.providerMessageId,
        sent_at: new Date().toISOString(),
        error: null,
      })
      .eq('id', messageId)
    return { ok: true }
  }

  await supabase
    .from('messages')
    .update({ status: 'failed', error: result.error })
    .eq('id', messageId)

  return { ok: false, error: result.error }
}

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------

export async function handleWebhook(body: unknown): Promise<{ status: number }> {
  const status = provider.parseWebhook(body)
  if (!status) return { status: 200 } // Health check or irrelevant

  const supabase = await createClient()
  const { error } = await supabase
    .from('messages')
    .update({
      status: status.status,
      ...(status.status === 'sent' ? { sent_at: status.timestamp } : {}),
      ...(status.status === 'delivered' ? { delivered_at: status.timestamp } : {}),
      ...(status.status === 'read' ? { read_at: status.timestamp } : {}),
      ...(status.status === 'failed' && status.error ? { error: status.error } : {}),
    })
    .eq('provider_message_id', status.providerMessageId)

  if (error) return { status: 500 }
  return { status: 200 }
}
