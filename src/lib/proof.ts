import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

import { supabase } from '@/lib/supabase/client'

/**
 * M8 — native camera + tamper-evident delivery proof.
 *
 * The SRS (FR-DEL-01..10) and the database already enforce the hard parts:
 * delivery_proofs is insert-only (UPDATE/DELETE blocked by trigger + RLS),
 * the server stamps recorded_at, and a proof insert flips the deliverable to
 * delivered. This module is the client half:
 *
 * - capture(): opens the NATIVE camera only. Gallery selection is impossible
 *   (CameraSource.Camera is non-negotiable — a gallery photo breaks the
 *   proof chain).
 * - compress(): resizes the longest edge to 1600px and re-encodes as JPEG so
 *   a 6MB photo becomes <400KB — uploadable on venue mobile data.
 * - The proof photo's EXIF is stripped (re-encode drops it), so no device
 *   clock or GPS is ever trusted.
 * - upload(): writes to delivery-proofs/{event_id}/{deliverable_id}/... and
 *   inserts the proof row. The timestamp comes from the database default,
 *   never the device.
 * - Offline: if the upload/insert fails, the caller may persist the local
 *   photo + pending row (see the offline queue) and retry on reconnect.
 */

/** Longest-edge resize target. 1600px keeps text legible, stays under ~400KB. */
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.7

export interface CaptureResult {
  /** Base64 JPEG (EXIF stripped) after compression. */
  dataUrl: string
  /** Approx bytes after compression. */
  sizeBytes: number
}

/**
 * Open the native camera and return a compressed, EXIF-stripped JPEG.
 * Throws if the user cancels, the permission is denied, or capture fails.
 */
export async function captureProofPhoto(): Promise<CaptureResult> {
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera, // NOT Prompt, NOT Photos
    allowEditing: false,
    quality: 70,
    resultType: CameraResultType.DataUrl,
  })

  const raw = photo.dataUrl
  if (!raw) throw new Error('No photo data returned from the camera')

  const compressed = await compressDataUrl(raw, MAX_EDGE, JPEG_QUALITY)
  return { dataUrl: compressed.dataUrl, sizeBytes: compressed.sizeBytes }
}

export interface CompressResult {
  dataUrl: string
  sizeBytes: number
}

/**
 * Downscale + re-encode a data URL to JPEG. Re-encoding drops EXIF (and any
 * GPS embedded in it) as a side effect — exactly what the proof chain needs.
 * Pure browser canvas, no dependencies.
 */
export function compressDataUrl(dataUrl: string, maxEdge = MAX_EDGE, quality = JPEG_QUALITY): Promise<CompressResult> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 2D unavailable'))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        const out = canvas.toDataURL('image/jpeg', quality)
        // Approx size: 3/4 of base64 chars is bytes.
        const sizeBytes = Math.round((out.length - out.indexOf(',') - 1) * 0.75)
        resolve({ dataUrl: out, sizeBytes })
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    img.onerror = () => reject(new Error('Could not decode the captured image'))
    img.src = dataUrl
  })
}

export interface UploadProofInput {
  eventId: string
  deliverableId: string
  dataUrl: string
}

export interface ProofRow {
  id: string
  event_id: string
  deliverable_id: string
  storage_bucket: string
  storage_path: string
  captured_by: string
  /** Server-stamped. The only timestamp that is evidence. */
  recorded_at: string
}

/**
 * Upload the photo and insert the proof row. Returns the committed row.
 * Throws on any failure — the caller decides whether to queue offline.
 */
export async function submitProof({ eventId, deliverableId, dataUrl }: UploadProofInput): Promise<ProofRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const id = crypto.randomUUID()
  const path = `${eventId}/${deliverableId}/${id}.jpg`

  const bytes = dataUrlToBlob(dataUrl)
  const { error: uploadError } = await supabase.storage
    .from('delivery-proofs')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false })
  if (uploadError) throw uploadError

  const { data: row, error: insertError } = await supabase
    .from('delivery_proofs')
    .insert({
      event_id: eventId,
      deliverable_id: deliverableId,
      storage_bucket: 'delivery-proofs',
      storage_path: path,
      captured_by: user.id,
    })
    .select()
    .single()
  if (insertError) throw insertError

  return row as unknown as ProofRow
}

/** data URL -> Blob for storage upload. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',')
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
