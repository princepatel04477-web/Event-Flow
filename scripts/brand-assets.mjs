#!/usr/bin/env node
/**
 * Regenerate every brand raster in the project from ONE source file.
 *
 *   node scripts/brand-assets.mjs
 *
 * Source: assets/brand/eventflow-logo.png — the EventFlow lockup on a white
 * ground (mark above, "EventFlow" wordmark, PLAN · MANAGE · CELEBRATE rule).
 *
 * Why a script instead of exported PNGs checked in by hand: there are 33
 * generated files across five Android densities, three web icon conventions
 * and the install/offline pages. Hand-exporting them means the next logo tweak
 * silently updates four of them and leaves twenty-nine stale — which shows up
 * as a launcher icon that disagrees with the splash on exactly the phones you
 * did not test. Every raster below is derived, so a re-run is the only step.
 *
 * Two cutouts drive everything:
 *   MARK  — the stylised E + calendar only. Square-ish, reads at 48px. This is
 *           the launcher icon and the favicon.
 *   LOCK  — mark + wordmark + tagline. Needs width; only used where there is
 *           room for it (splash, install page).
 * Their bounding boxes are measured from the source, not eyeballed — see
 * BBOX below and the ink-band scan that produced it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'assets/brand/eventflow-logo.png')

/**
 * Measured ink bounds in the 1254x1254 source (scan: rows with >3 non-white
 * pixels). Re-measure if the source file is ever replaced.
 *   mark     y 175-788   x 410-933
 *   wordmark y 831-994   x 113-1151
 *   tagline  y 1033-1056 x 113-1143
 */
const BBOX = {
  mark: { left: 410, top: 175, width: 524, height: 614 },
  lockup: { left: 113, top: 175, width: 1039, height: 882 },
}

/**
 * The app ground, and the only colour that may sit behind the splash.
 * Must stay equal to `--ef-paper` in src/app/globals.css and `themeColor` in
 * src/app/layout.tsx: a splash painted in a different colour is the flash that
 * tells everyone this is a web view.
 */
const PAPER = { r: 0xf8, g: 0xf9, b: 0xfa, alpha: 1 }
/** Launcher-icon ground. The logo is drawn for white; anything else dims it. */
const ICON_BG = { r: 0xff, g: 0xff, b: 0xff, alpha: 1 }

/**
 * Every PNG below is a flat ground plus one gradient mark — under 256 colours
 * in practice, so palette encoding is lossless-looking and roughly 6x smaller.
 * That matters: the eleven splash bitmaps ship inside the APK, and at sharp's
 * default truecolour settings they alone added ~4MB to a 6.5MB app.
 */
const PNG = { compressionLevel: 9, palette: true, quality: 92, effort: 10 }

/**
 * Cut the white ground away.
 *
 * The source has no alpha and its ground is 254-255 flat white, so alpha comes
 * from distance-to-white: fully opaque as soon as a pixel is more than RAMP
 * below white, with the ramp itself covering only the antialiased edge. Colour
 * is then un-premultiplied against white, which is what stops a blue edge from
 * turning milky when the cutout is later composited onto a dark ground.
 *
 * A naive `alpha = (255 - min) / 255` was tried first and is wrong: the light
 * cyan in the mark has min channel ~40, so it would have come out 84% opaque —
 * the icon looks washed out and nobody can say why.
 *
 * DEADBAND is the other half, and it is not optional. The source ground is
 * 254-255 rather than a flat 255, so without it every ground pixel came out at
 * alpha 1/24 and — after un-premultiplying, which divides by that alpha — pure
 * white. Invisible on a white icon ground and glaring on the splash, where the
 * lockup sat inside a white rectangle on the #f8f9fa paper.
 */
const RAMP = 24
const DEADBAND = 3

async function cutout(box) {
  const { data, info } = await sharp(SRC)
    .extract(box)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const out = Buffer.alloc(info.width * info.height * 4)
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * 4
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    const a = Math.min(1, Math.max(0, 255 - Math.min(r, g, b) - DEADBAND) / RAMP)
    if (a <= 0) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0
      continue
    }
    // un-premultiply against white
    out[o] = Math.max(0, Math.min(255, Math.round((r - 255 * (1 - a)) / a)))
    out[o + 1] = Math.max(0, Math.min(255, Math.round((g - 255 * (1 - a)) / a)))
    out[o + 2] = Math.max(0, Math.min(255, Math.round((b - 255 * (1 - a)) / a)))
    out[o + 3] = Math.round(a * 255)
  }
  // Deliberately NOT `PNG`: this buffer is an intermediate that sharp reads
  // straight back in. Palette-quantising it would throw away gradient and
  // alpha detail before the resize that actually needs it, and cost time for
  // a file that is never written.
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer()
}

/** Centre `art` on a `size`x`size` canvas, scaled to `ratio` of the canvas. */
async function square(art, size, ratio, background) {
  const inner = Math.round(size * ratio)
  const scaled = await sharp(art)
    .resize(inner, inner, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: scaled, gravity: 'centre' }])
    .png(PNG)
    .toBuffer()
}

/** Circular mask, for ic_launcher_round on launchers that still use it. */
async function round(buf, size) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  )
  return sharp(buf)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png(PNG)
    .toBuffer()
}

async function write(rel, buf) {
  const path = join(ROOT, rel)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, buf)
  console.log(`  ${rel}  ${buf.length.toLocaleString()} B`)
}

/**
 * A .ico holding PNG frames. sharp cannot write ICO, and the container is 22
 * bytes of header per frame, so it is hand-assembled rather than pulling a
 * dependency in for it. PNG-in-ICO is understood by every browser this app
 * supports; the ancient BMP-in-ICO form is not needed.
 */
function ico(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(frames.length, 4)

  let offset = 6 + frames.length * 16
  const dir = []
  for (const { size, buf } of frames) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2) // palette
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(buf.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += buf.length
    dir.push(e)
  }
  return Buffer.concat([header, ...dir, ...frames.map((f) => f.buf)])
}

/** Full lockup centred on the paper ground, for splash screens. */
async function splash(lockup, width, height) {
  // 62% of the shorter side keeps the wordmark legible on a 320px-wide mdpi
  // screen without the lockup touching the edges on a tall xxxhdpi one.
  const target = Math.round(Math.min(width, height) * 0.62)
  const art = await sharp(lockup)
    .resize(target, target, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  return sharp({ create: { width, height, channels: 4, background: PAPER } })
    .composite([{ input: art, gravity: 'centre' }])
    .png(PNG)
    .toBuffer()
}

/**
 * Inline the mark into the two standalone HTML pages, as a data: URI.
 *
 * Neither page may reference /brand/*.png:
 *   offline.html renders precisely when the network is unreachable, so an
 *     external src is a broken-image icon by construction;
 *   install.html is opened from the deployed site, from the storage bucket and
 *     from a copy mailed to a handset, and a root-relative path is wrong in two
 *     of those three.
 *
 * The target is the element carrying `data-brand-mark`, so the pages stay
 * hand-editable everywhere except the one attribute this owns. Missing the
 * marker is a hard error rather than a warning: a silent no-op here means the
 * pages ship with `src=""` and nobody notices until install day.
 */
async function inlineMark(rel, dataUri) {
  const path = join(ROOT, rel)
  const html = await readFile(path, 'utf8')
  const pattern = /(<img\b[^>]*\bdata-brand-mark\b[^>]*\bsrc=")[^"]*(")/
  if (!pattern.test(html)) {
    throw new Error(`${rel}: no <img data-brand-mark ... src="..."> to fill`)
  }
  const next = html.replace(pattern, `$1${dataUri}$2`)
  await writeFile(path, next)
  console.log(`  ${rel}  mark inlined (${dataUri.length.toLocaleString()} chars)`)
}

const DENSITIES = [
  // [name, legacy launcher px, adaptive foreground px]
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]

const SPLASHES = [
  ['drawable', 480, 320],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
]

async function main() {
  const mark = await cutout(BBOX.mark)
  const lockup = await cutout(BBOX.lockup)

  console.log('android launcher icons')
  for (const [density, legacy, fg] of DENSITIES) {
    const base = `android/app/src/main/res/mipmap-${density}`
    // Legacy (pre-O) icon: the whole bitmap is shown, so the art fills more of
    // it than the adaptive foreground does.
    const sq = await square(mark, legacy, 0.74, ICON_BG)
    await write(`${base}/ic_launcher.png`, sq)
    await write(`${base}/ic_launcher_round.png`, await round(sq, legacy))
    // Adaptive foreground: the launcher may mask this to a circle, squircle or
    // teardrop and animates it inside the 108dp canvas, so only the central
    // 66dp is guaranteed visible. 0.58 keeps the calendar badge — the first
    // thing a crop eats — inside the safe zone on every mask shape.
    await write(`${base}/ic_launcher_foreground.png`, await square(mark, fg, 0.58, null))
  }

  console.log('android splash')
  for (const [dir, w, h] of SPLASHES) {
    await write(`android/app/src/main/res/${dir}/splash.png`, await splash(lockup, w, h))
  }
  // Android 12+ draws its own splash and wants just the mark: the system masks
  // it to a circle and animates it, so the wordmark would be clipped away.
  await write(
    'android/app/src/main/res/drawable/splash_icon.png',
    await square(mark, 960, 0.6, null),
  )

  console.log('web icons')
  // Next.js App Router file conventions: src/app/{icon,apple-icon}.png are
  // picked up automatically and fingerprinted, no <link> tags needed.
  await write('src/app/icon.png', await square(mark, 512, 0.82, ICON_BG))
  // Apple requires an opaque icon; a transparent one renders black on iOS.
  await write('src/app/apple-icon.png', await square(mark, 180, 0.78, ICON_BG))
  // The ICO frames are the one place `PNG` must NOT be used. Next's build-time
  // image pipeline decodes src/app/favicon.ico to derive its <link> metadata,
  // and its ICO reader accepts RGBA frames only — a palette-indexed frame
  // fails the whole production build with "The PNG is not in RGBA format!",
  // which reads like a corrupt file rather than a compression setting. Hence
  // ensureAlpha() and palette: false. At 16-48px the size cost is ~2KB total.
  await write(
    'src/app/favicon.ico',
    ico(
      await Promise.all(
        [16, 32, 48].map(async (size) => ({
          size,
          buf: await sharp(await square(mark, size, 0.92, ICON_BG))
            .ensureAlpha()
            .png({ compressionLevel: 9, palette: false })
            .toBuffer(),
        })),
      ),
    ),
  )

  console.log('pwa + page assets')
  await write('public/brand/icon-192.png', await square(mark, 192, 0.82, ICON_BG))
  await write('public/brand/icon-512.png', await square(mark, 512, 0.82, ICON_BG))
  // Maskable: Android crops up to 20% off every edge, so the art may only
  // occupy the inner 60% circle. Same reasoning as the adaptive foreground.
  await write('public/brand/maskable-512.png', await square(mark, 512, 0.56, ICON_BG))
  // Transparent, for placing on the paper ground in the app itself.
  await write('public/brand/eventflow-mark.png', await square(mark, 256, 1, null))
  await write(
    'public/brand/eventflow-lockup.png',
    await sharp(lockup).resize(720, null, { fit: 'inside' }).png(PNG).toBuffer(),
  )

  console.log('standalone html')
  // 128px, because both pages draw it at 88-96 CSS px and every byte here is
  // inlined into the document. At 256 the base64 alone was larger than
  // offline.html itself.
  const inline = await square(mark, 128, 1, null)
  const dataUri = `data:image/png;base64,${inline.toString('base64')}`
  await inlineMark('public/install.html', dataUri)
  await inlineMark('public/offline.html', dataUri)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
