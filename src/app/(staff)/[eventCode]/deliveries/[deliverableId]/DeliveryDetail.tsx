'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

import { BoxIcon, GiftIcon, ShieldAlertIcon, UploadIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { LinkButton } from '@/components/ui/LinkButton'
import { formatDateTime } from '@/lib/utils'
import { captureProofPhoto, compressDataUrl, submitProof, type ProofRow } from '@/lib/proof'
import { queueProof, queuedProofCount, type QueuedProof } from '@/lib/proof-queue'
import { createClient } from '@/lib/supabase/client'
import { useOnline } from '@/lib/useOnline'

/**
 * Delivery detail + photo proof (R1).
 *
 * One screen does the whole job: it shows WHO/WHERE/WHAT before the camera
 * opens (so a staff member walking a corridor confirms the right door),
 * captures through the native rear camera, shows a confirm/retake preview
 * with the same details overlaid, then uploads and inserts the proof row.
 *
 * HONESTY NOTE ON CAPTURE: `<input capture>` is a hint, not a guarantee on
 * web — some Android builds still offer a gallery path. This web build does
 * not pretend the chain is airtight; the APK closes the gallery with the
 * native camera plugin (CameraSource.Camera, see src/lib/proof.ts).
 *
 * The proof row's timestamp is the database default, never the device. A
 * proof is only "delivered" after the server confirms the insert — the
 * delivery_proofs insert trigger flips deliverables.status.
 *
 * Offline: on any upload/insert failure the photo + pending payload go into
 * the Dexie queue. The UI says "Queued — will sync", never "Delivered".
 */

export interface DeliveryDetailData {
  id: string
  kind: 'hamper' | 'return_gift'
  status: string
  itemName: string | null
  quantity: number
  groupId: string
  headName: string | null
  primaryMobile: string | null
  hotelName: string | null
  roomNumber: string | null
  floor: string | null
}

export interface DeliveryDetailProps {
  eventId: string
  eventCode: string
  deliverableId: string
}

type Phase =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'ready' }
  | { name: 'capturing' }
  | { name: 'preview' }
  | { name: 'uploading' }
  | { name: 'queued'; entry: QueuedProof | null }
  | { name: 'done'; proof: ProofRow | null }

/** A row of the proof stub: mono label left, mono figure right. */
function StubRow({
  label,
  value,
  tone = 'muted',
}: {
  label: string
  value: string
  tone?: 'muted' | 'ink'
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule/60 px-4 py-2.5 last:border-0">
      <dt className="eyebrow shrink-0">{label}</dt>
      <dd
        className={`figure min-w-0 text-right text-xs break-all ${
          tone === 'ink' ? 'text-ink' : 'text-muted'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-2 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{value}</span>
    </div>
  )
}

export function DeliveryDetail({ eventId, eventCode, deliverableId }: DeliveryDetailProps) {
  const online = useOnline()

  const [detail, setDetail] = useState<DeliveryDetailData | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: 'loading' })
  const [previewDataUrl, setPreviewDataUrl] = useState('')
  const [receivedBy, setReceivedBy] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [queuedCount, setQueuedCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    const supabase = createClient()
    supabase
      .from('deliverables')
      .select(
        `id, kind, status, group_id, quantity, item_name,
         guest_groups ( head_name, primary_mobile ),
         rooms ( room_number, floor, hotels ( name ) )`,
      )
      .eq('id', deliverableId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setPhase({ name: 'error', message: err?.message ?? 'Could not load this delivery.' })
          return
        }
        setDetail({
          id: data.id,
          kind: data.kind as 'hamper' | 'return_gift',
          status: data.status as string,
          itemName: data.item_name as string | null,
          quantity: data.quantity as number,
          groupId: data.group_id as string,
          headName: (data.guest_groups as unknown as { head_name: string | null } | null)?.head_name ?? null,
          primaryMobile: (data.guest_groups as unknown as { primary_mobile: string | null } | null)?.primary_mobile ?? null,
          hotelName: ((data.rooms as unknown as { hotels: { name: string } | null } | null)?.hotels?.name) ?? null,
          roomNumber: (data.rooms as unknown as { room_number: string | null } | null)?.room_number ?? null,
          floor: (data.rooms as unknown as { floor: string | null } | null)?.floor ?? null,
        })
        setPhase({ name: 'ready' })
      })
  }

  useEffect(() => {
    load()
    void queuedProofCount().then(setQueuedCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverableId])

  if (phase.name === 'loading' || !detail) {
    return <Card><CardBody className="py-10 text-center text-muted">Loading…</CardBody></Card>
  }
  if (phase.name === 'error') {
    return (
      <Card>
        <CardBody className="flex flex-col items-start gap-3">
          <p className="flex items-start gap-2 rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger">
            <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{phase.message}</span>
          </p>
          <Button variant="secondary" onClick={() => { setPhase({ name: 'loading' }); load() }}>Try again</Button>
        </CardBody>
      </Card>
    )
  }

  // Already delivered — nothing more to do here.
  if (detail.status === 'delivered' && phase.name !== 'done') {
    return (
      <section className="flex flex-col items-center py-6 text-center">
        {/* The same seal, not animated: this row was sealed on some earlier
            visit, and replaying the stamp would claim credit for a thing
            that already happened. */}
        <div
          aria-hidden
          className="relative flex h-24 w-24 flex-col items-center justify-center rounded-full border-2 border-brand/60 bg-brand-tint"
        >
          <span className="absolute inset-2 rounded-full border border-brand/35" />
          <span className="font-display text-xs leading-none tracking-[0.2em] text-brand indent-[0.2em]">
            SEALED
          </span>
        </div>
        <p className="mt-4 text-lg font-medium text-ink">Already delivered</p>
        <p className="mt-1.5 text-sm text-muted">
          {detail.kind === 'hamper' ? 'Hamper' : 'Return gift'} for{' '}
          {detail.headName ?? 'this family'} — photo proof is on file, and it cannot be
          replaced.
        </p>
        <LinkButton
          href={`/${eventCode}/hospitality/deliveries`}
          variant="secondary"
          size="lg"
          fullWidth
          className="mt-5"
        >
          Back to run
        </LinkButton>
      </section>
    )
  }

  async function handleCapture(dataUrl: string) {
    // Compress harder if the native path gave us something huge.
    let url = dataUrl
    try {
      const c = await compressDataUrl(dataUrl, 1200, 0.65)
      url = c.dataUrl
    } catch {
      // Fall back to the raw data URL; upload will still work.
    }
    setPreviewDataUrl(url)
    setPhase({ name: 'preview' })
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      void handleCapture(String(reader.result))
    }
    reader.readAsDataURL(file)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleNativeCapture() {
    setPhase({ name: 'capturing' })
    setError(null)
    try {
      const shot = await captureProofPhoto()
      setPreviewDataUrl(shot.dataUrl)
      setPhase({ name: 'preview' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the camera.')
      setPhase({ name: 'ready' })
    }
  }

  async function handleConfirm() {
    if (!detail) return
    const dataUrl = previewDataUrl
    setPhase({ name: 'uploading' })
    setError(null)
    try {
      // Offline: queue immediately — the banner + reconnect flush handle sync.
      if (!online) {
        const entry = await queueProof({ eventId, deliverableId, dataUrl })
        setPhase({ name: 'queued', entry })
        setQueuedCount((n) => n + 1)
        return
      }
      const row = await submitProof({ eventId, deliverableId, dataUrl })
      if (row) {
        setPhase({ name: 'done', proof: row })
      }
    } catch {
      // Failed while online — queue for retry rather than lose the photo.
      try {
        const entry = await queueProof({ eventId, deliverableId, dataUrl })
        setPhase({ name: 'queued', entry })
        setQueuedCount((n) => n + 1)
      } catch (qe) {
        setError(qe instanceof Error ? qe.message : 'Could not save the photo.')
        setPhase({ name: 'preview' })
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href={`/${eventCode}/hospitality/deliveries`} className="text-sm font-semibold text-ink underline">
          ← Deliveries
        </Link>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-base font-semibold text-fg">
            {detail.kind === 'hamper' ? <GiftIcon className="h-5 w-5" aria-hidden /> : <BoxIcon className="h-5 w-5" aria-hidden />}
            {detail.kind === 'hamper' ? 'Hamper' : 'Return gift'}
            {detail.quantity > 1 ? ` ×${detail.quantity}` : ''}
          </p>
          <DetailRow label="Guest / family" value={detail.headName ?? '—'} />
          <DetailRow label="Room" value={detail.roomNumber ? `${detail.hotelName ?? ''} · Room ${detail.roomNumber}${detail.floor ? ` (${detail.floor})` : ''}` : 'No room assigned'} />
          <DetailRow label="Item" value={detail.itemName ?? '—'} />
        </CardBody>
      </Card>

      {phase.name === 'ready' || phase.name === 'capturing' ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-4 py-8 text-center">
            <p className="text-lg font-semibold text-fg">Confirm you are at the right door</p>
            <p className="text-sm text-muted">
              {detail.headName ?? 'This family'} · {detail.roomNumber ? `Room ${detail.roomNumber} · ${detail.hotelName ?? ''}` : 'No room assigned'}
            </p>
            <p className="text-sm text-muted">
              Then take a photo of the {detail.kind === 'hamper' ? 'hamper' : 'return gift'} with the room number visible.
            </p>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={handleFile}
            />

            <Button size="lg" fullWidth loading={phase.name === 'capturing'} onClick={handleNativeCapture}>
              Take photo
            </Button>
            <Button variant="secondary" fullWidth onClick={() => inputRef.current?.click()}>
              Choose photo
            </Button>
            <p className="text-xs text-subtle">
              On the APK build, “Take photo” opens the native rear camera only.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {phase.name === 'preview' || phase.name === 'uploading' ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewDataUrl} alt="Captured delivery proof" className="w-full rounded-xl border border-border" />
            <p className="text-sm font-semibold text-fg">Confirm this photo</p>
            <p className="text-sm text-muted">
              {detail.headName ?? 'This family'} · {detail.roomNumber ? `Room ${detail.roomNumber}` : 'No room'} ·{' '}
              {detail.kind === 'hamper' ? 'Hamper' : 'Return gift'}
            </p>
            <input
              type="text"
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
              placeholder="Received by (name) — optional"
              className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base"
            />
            <div className="flex gap-2">
              <Button variant="secondary" fullWidth disabled={phase.name === 'uploading'} onClick={() => setPhase({ name: 'ready' })}>
                Retake
              </Button>
              <Button fullWidth loading={phase.name === 'uploading'} onClick={() => void handleConfirm()}>
                Confirm delivery
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {phase.name === 'queued' ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-8 text-center">
            <UploadIcon className="h-8 w-8 text-warning" aria-hidden />
            <p className="text-lg font-semibold text-fg">Queued — will sync</p>
            <p className="text-sm text-muted">
              No connection right now. The photo is saved on this phone and will upload automatically when
              the network returns. This is NOT marked delivered yet.
            </p>
            <p className="text-xs text-subtle">{queuedCount} proof{queuedCount === 1 ? '' : 's'} waiting to sync</p>
            <Link href={`/${eventCode}/hospitality/deliveries`} className="text-sm font-semibold text-ink underline">
              Back to deliveries
            </Link>
          </CardBody>
        </Card>
      ) : null}

      {/* The seal.
          This is the only flourish in the app, and it is here because this
          is the only action that can never be undone: `delivery_proofs` has
          no update policy and no delete policy, and two unconditional
          triggers refuse both — for everyone, including the admin who owns
          the account. The animation is the receipt for that finality.

          What follows it is a stub, not a confirmation dialog: the figures
          that were actually written, including the server time that
          overrode whatever this phone believes the time is. */}
      {phase.name === 'done' ? (
        <section className="flex flex-col items-center py-4">
          <p className="eyebrow text-ledger-green">Proof recorded</p>

          <div
            aria-hidden
            className="seal-in relative mt-3.5 flex h-33 w-33 flex-col items-center justify-center rounded-full border-2 border-brand bg-[radial-gradient(circle,var(--ef-brand-tint),transparent)] shadow-[0_0_46px_-10px] shadow-brand/60"
          >
            <span className="absolute inset-2 rounded-full border border-brand/45" />
            <span className="font-display text-sm leading-none tracking-[0.24em] text-brand indent-[0.24em]">
              SEALED
            </span>
            <span className="mt-2 h-px w-8 bg-brand/50" />
            <span className="figure mt-2 text-[0.625rem] text-ink">
              {phase.proof ? phase.proof.id.slice(0, 8).toUpperCase() : '—'}
            </span>
          </div>

          <div className="stub-in mt-6 w-full overflow-hidden rounded-2xl border border-brand/25 bg-surface">
            <div className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-3">
              <span className="text-base font-medium text-ink">
                {detail.headName ?? 'This family'}
              </span>
              <span className="figure text-base text-ink">
                {detail.roomNumber ?? '—'}
              </span>
            </div>

            <dl>
              <StubRow label="Kind" value={detail.kind === 'hamper' ? 'Hamper' : 'Return gift'} />
              <StubRow
                label="Server time"
                value={phase.proof ? formatDateTime(phase.proof.recorded_at) : '—'}
                tone="ink"
              />
              <StubRow
                label="Device claim"
                value={`${formatDateTime(new Date())} · recorded, untrusted`}
              />
              <StubRow label="Storage" value={phase.proof?.storage_path ?? '—'} />
            </dl>

            <p className="bg-green-tint px-4 py-3 text-sm leading-snug text-ink">
              No update policy. No delete policy. Two database triggers refuse both —{' '}
              <span className="text-ledger-green">
                for everyone, including the admin who owns the account.
              </span>
            </p>
          </div>

          <LinkButton
            href={`/${eventCode}/hospitality/deliveries`}
            size="lg"
            fullWidth
            className="mt-5"
          >
            Back to run
          </LinkButton>
        </section>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default DeliveryDetail
