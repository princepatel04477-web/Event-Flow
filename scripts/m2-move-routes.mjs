// Script to move routes and fix references. Run: node scripts/m2-move-routes.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'

const BASE = 'src/app/(staff)/[eventCode]'

const MOVES = [
  // [from, to]
  ['guests/page.tsx',    'guests/list/page.tsx'],
  ['guests/loading.tsx', 'guests/list/loading.tsx'],
  ['import/page.tsx',    'guests/import/page.tsx'],
  ['import/loading.tsx', 'guests/import/loading.tsx'],
  ['export/page.tsx',    'guests/export/page.tsx'],
  // RSVP
  ['queue/page.tsx',     'rsvp/queue/page.tsx'],
  ['queue/loading.tsx',  'rsvp/queue/loading.tsx'],
  ['call/[groupId]/page.tsx',    'rsvp/call/[groupId]/page.tsx'],
  ['call/[groupId]/loading.tsx', 'rsvp/call/[groupId]/loading.tsx'],
  ['call/[groupId]/CallScreen.tsx', 'rsvp/call/[groupId]/CallScreen.tsx'],
  ['call/[groupId]/BackRow.tsx',    'rsvp/call/[groupId]/BackRow.tsx'],
  ['rsvp/page.tsx',      'rsvp/status/page.tsx'],
  ['rsvp/loading.tsx',   'rsvp/status/loading.tsx'],
  ['rsvp/[groupId]/page.tsx',       'rsvp/status/[groupId]/page.tsx'],
  ['rsvp/[groupId]/RsvpLogForm.tsx','rsvp/status/[groupId]/RsvpLogForm.tsx'],
  ['rsvp/[groupId]/loading.tsx',    'rsvp/status/[groupId]/loading.tsx'],
  ['review/page.tsx',     'rsvp/review/page.tsx'],
  ['review/loading.tsx',  'rsvp/review/loading.tsx'],
  ['review/[extractionId]/page.tsx',      'rsvp/review/[extractionId]/page.tsx'],
  ['review/[extractionId]/loading.tsx',   'rsvp/review/[extractionId]/loading.tsx'],
  ['review/[extractionId]/ReviewForm.tsx','rsvp/review/[extractionId]/ReviewForm.tsx'],
  // Logistics
  ['arrivals/page.tsx',           'logistics/arrivals/page.tsx'],
  ['departures/page.tsx',         'logistics/departures/page.tsx'],
  ['departures/new/page.tsx',     'logistics/departures/new/page.tsx'],
  ['fleet/page.tsx',              'logistics/fleet/page.tsx'],
  // Hospitality
  ['rooms/page.tsx',              'hospitality/rooms/page.tsx'],
  ['rooms/loading.tsx',           'hospitality/rooms/loading.tsx'],
  ['rooms/allocate/page.tsx',     'hospitality/rooms/allocate/page.tsx'],
  ['rooms/allocate/loading.tsx',  'hospitality/rooms/allocate/loading.tsx'],
  ['checkin/page.tsx',            'hospitality/checkin/page.tsx'],
  ['deliveries/page.tsx',         'hospitality/deliveries/page.tsx'],
  ['deliveries/[deliverableId]/page.tsx', 'hospitality/deliveries/[deliverableId]/page.tsx'],
  // Dashboard
  ['page.tsx', 'dashboard/page.tsx'],
  ['loading.tsx', 'dashboard/loading.tsx'],
]

for (const [from, to] of MOVES) {
  const src = join(BASE, from)
  const dst = join(BASE, to)
  if (!existsSync(src)) { console.log(`SKIP (missing): ${from}`); continue }
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(src, dst)
  console.log(`OK ${from} → ${to}`)
}

// Copy _components directories
const COMPONENT_COPIES = [
  ['guests/_components', 'guests/list/_components'],
  ['import/_components', 'guests/import/_components'],
  ['queue', 'rsvp/queue'],
  ['calls/unmatched', 'rsvp/unmatched'],
  ['departures', 'logistics/departures'],
  ['fleet', 'logistics/fleet'],
  ['logistics', 'logistics/trips'],
  ['rooms', 'hospitality/rooms'],
  ['rooms/allocate', 'hospitality/rooms/allocate'],
  ['checkin', 'hospitality/checkin'],
  ['deliveries', 'hospitality/deliveries'],
]

for (const [from, to] of COMPONENT_COPIES) {
  const src = join(BASE, from)
  const dst = join(BASE, to)
  if (!existsSync(src)) { console.log(`SKIP dir (missing): ${from}`); continue }
  execSync(`xcopy "${src}" "${dst}" /E /I /Y /Q`, { stdio: 'pipe' })
  console.log(`DIR OK ${from} → ${to}`)
}

console.log('\nDone. Now run: npx tsc --noEmit to check for errors.')
