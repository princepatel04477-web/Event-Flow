// Fix missing client component files. Run: node scripts/m2-copy-components.mjs
import { execSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'src/app/(staff)/[eventCode]'

const COPIES = [
  // These are the xcopy commands that failed earlier (directory copies)
  ['rooms', 'hospitality/rooms'],
  ['rooms/allocate', 'hospitality/rooms/allocate'],
  ['checkin', 'hospitality/checkin'],
  ['deliveries', 'hospitality/deliveries'],
  ['departures', 'logistics/departures'],
  ['logistics', 'logistics/trips'],
  ['fleet', 'logistics/fleet'],
]

for (const [from, to] of COPIES) {
  const src = join(BASE, from)
  const dst = join(BASE, to)
  if (!existsSync(src)) { console.log(`SKIP: ${src}`); continue }
  console.log(`COPY ${from}/ → ${to}/`)
  // Use robocopy for directories (handles locked files better)
  execSync(`robocopy "${src}" "${dst}" /E /COPY:DAT /R:0 /W:0 /NFL /NDL /NJH /NJS`, { stdio: 'pipe' })
}

console.log('done')
