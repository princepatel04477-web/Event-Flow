import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

import { supabase } from '@/lib/supabase/client'
import { readStoredClaims } from '@/lib/native/session-keeper'

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
 * - compress(): resizes the longest edge and re-encodes as JPEG so a 6MB
 *   photo becomes small enough for venue mobile data. The re-encode strips
 *   EXIF (device clock, GPS) as a side effect — exactly what the proof chain
 *   needs.
 * - submitProof(): writes to delivery-proofs/{event_id}/{deliverable_id}/
 *   {idempotency_key}.jpg and inserts the proof row. The timestamp comes
 *   from the database default, never the device.
 *
 * IDEMPOTENCY: the storage filename is the idempotency key. The offline
 * queue passes its localId; a retry of an already-committed proof (photo
 * uploaded, row inserted, response lost) hits the unique index on
 * storage_path and is treated as "already synced", not a duplicate.
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

/** Read the EXIF orientation tag (1-8) from a JPEG, or null when absent. */
function exifOrientation(dataUrl: string): number | null {
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const bin = atob(b64)
    // JPEG SOI marker.
    if (bin.charCodeAt(0) !== 0xff || bin.charCodeAt(1) !== 0xd8) return null
    let off = 2
    while (off + 4 <= bin.length) {
      if (bin.charCodeAt(off) !== 0xff) break
      const marker = bin.charCodeAt(off + 1)
      // Standalone markers without length.
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2
        continue
      }
      const len = (bin.charCodeAt(off + 2) << 8) | bin.charCodeAt(off + 3)
      // APP1 (0xE1) holds EXIF.
      if (marker === 0xe1 && len >= 8) {
        const seg = bin.slice(off + 4, off + 2 + len)
        if (
          seg.length >= 14 &&
          String.fromCharCode(seg.charCodeAt(0), seg.charCodeAt(1)) === 'E' + 'x' &&
          seg.charCodeAt(2) === 0x69 &&
          seg.charCodeAt(3) === 0x66
        ) {
          const tiffEndian = seg.charCodeAt(6)
          const little = tiffEndian === 0x49
          const readU16 = (i: number) =>
            little ? seg.charCodeAt(i) | (seg.charCodeAt(i + 1) << 8) : (seg.charCodeAt(i) << 8) | seg.charCodeAt(i + 1)
          const readU32 = (i: number) =>
            little
              ? seg.charCodeAt(i) |
                (seg.charCodeAt(i + 1) << 8) |
                (seg.charCodeAt(i + 2) << 16) |
                (seg.charCodeAt(i + 3) << 24)
              : (seg.charCodeAt(i) << 24) |
                (seg.charCodeAt(i + 1) << 16) |
                (seg.charCodeAt(i + 2) << 8) |
                seg.charCodeAt(i + 3)
          const ifd0 = readU32(10)
          const count = readU16(ifd0 + 8)
          for (let i = 0; i < count; i++) {
            const entry = ifd0 + 8 + 2 + i * 12
            const tag = readU16(entry)
            // 0x0112 = Orientation.
            if (tag === 0x0112) return readU16(entry + 8)
          }
        }
      }
      off += 2 + len
    }
  } catch {
    // Any malformed-EXIF error: draw without rotation rather than fail.
    return null
  }
  return null
}

/** Map EXIF orientation to a {rotation, flip} draw transform. */
function orientationTransform(o: number): { rotation: number; flipX: boolean; flipY: boolean } {
  switch (o) {
    case 2:
      return { rotation: 0, flipX: true, flipY: false }
    case 3:
      return { rotation: 180, flipX: false, flipY: false }
    case 4:
      return { rotation: 180, flipX: true, flipY: false }
    case 5:
      return { rotation: 90, flipX: true, flipY: false }
    case 6:
      return { rotation: 90, flipX: false, flipY: false }
    case 7:
      return { rotation: 270, flipX: true, flipY: false }
    case 8:
      return { rotation: 270, flipX: false, flipY: false }
    default:
      return { rotation: 0, flipX: false, flipY: false }
  }
}

/**
 * Downscale + re-encode a data URL to JPEG. Re-encoding drops EXIF (and any
 * GPS embedded in it) as a side effect — exactly what the proof chain needs.
 * Honors the EXIF orientation tag when drawing, so an Android camera's
 * sideways JPEG comes out upright after the tag is stripped.
 * Pure browser canvas, no dependencies.
 */
export function compressDataUrl(dataUrl: string, maxEdge = MAX_EDGE, quality = JPEG_QUALITY): Promise<CompressResult> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const orientation = exifOrientation(dataUrl)
        const { rotation, flipX, flipY } = orientationTransform(orientation ?? 1)
        const rotated = rotation === 90 || rotation === 270

        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round((rotated ? img.height : img.width) * scale))
        const h = Math.max(1, Math.round((rotated ? img.width : img.height) * scale))

        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 2D unavailable'))
          return
        }

        ctx.save()
        ctx.translate(w / 2, h / 2)
        ctx.rotate((rotation * Math.PI) / 180)
        if (flipX) ctx.scale(-1, 1)
        if (flipY) ctx.scale(1, -1)
        const drawW = rotated ? h : w
        const drawH = rotated ? w : h
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH)
        ctx.restore()

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
  /**
   * Idempotency key — the offline queue's localId. Embedded in the storage
   * filename so a retry of an already-committed proof cannot duplicate it.
   * Defaults to a fresh UUID for direct (non-queued) callers.
   */
  idempotencyKey?: string
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
 *
 * Idempotent: when the insert hits the unique index on storage_path (a prior
 * flush already committed this proof), the existing row is returned and the
 * function reports success instead of throwing a duplicate.
 */
export async function submitProof({ eventId, deliverableId, dataUrl, idempotencyKey }: UploadProofInput): Promise<ProofRow> {
  // Code-auth (team) sessions have NO auth.uid() — supabase.auth.getUser()
  // returns null for them. The identity is the selected staff member, held
  // in the durable session store and carried to RLS via the code JWT claim.
  // The insert policy requires captured_by_staff = jwt_staff_member_id() for
  // a code session (captured_by stays null); an admin sets captured_by and
  // nulls captured_by_staff. Resolve which identity is present.
  const storedClaims = await readStoredClaims()
  const staffMemberId = storedClaims?.staffMemberId ?? null

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const hasAuthUser = Boolean(user)
  // A code session is the only case where getUser() is null but a valid
  // staff identity exists. Anything else genuinely is not signed in.
  if (!hasAuthUser && !staffMemberId) throw new Error('Not signed in')

  const key = idempotencyKey ?? crypto.randomUUID()
  const path = `${eventId}/${deliverableId}/${key}.jpg`

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
      // Code session: attribute to the selected staff member. Admin: the
      // real auth uid. The column default is app.current_identity(), but we
      // bypass it so an admin proof never sets a non-null captured_by_staff
      // (which the insert policy's `captured_by_staff IS NULL` branch rejects).
      ...(staffMemberId
        ? { captured_by: null, captured_by_staff: staffMemberId }
        : { captured_by: user?.id ?? null, captured_by_staff: null }),
    })
    .select()
    .single()
  if (insertError) {
    // Unique violation on storage_path: this proof already committed on a
    // prior flush. Not a duplicate — an already-synced proof.
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('delivery_proofs')
        .select('*')
        .eq('storage_path', path)
        .maybeSingle()
      if (existing) return existing as unknown as ProofRow
    }
    throw insertError
  }

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
