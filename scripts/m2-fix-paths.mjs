// Fix path references EVERYWHERE in src/. Run: node scripts/m2-fix-paths.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'src'

// Ordered: longer/more-specific first to avoid partial matches
const REPLACEMENTS = [
  // RSVP: call → rsvp/call (must be before /review)
  ['/${eventCode}/call/', '/${eventCode}/rsvp/call/'],
  ['`/${eventCode}/call/', '`/${eventCode}/rsvp/call/'],
  // RSVP: review → rsvp/review (before queue to avoid partial match)
  ['/${eventCode}/review/', '/${eventCode}/rsvp/review/'],
  ['`/${eventCode}/review/', '`/${eventCode}/rsvp/review/'],
  ['/${eventCode}/review`', '/${eventCode}/rsvp/review`'],
  ['/${eventCode}/review"', '/${eventCode}/rsvp/review"'],
  // RSVP: queue → rsvp/queue
  ['/${eventCode}/queue', '/${eventCode}/rsvp/queue'],
  ['`/${eventCode}/queue', '`/${eventCode}/rsvp/queue'],
  // RSVP: calls/unmatched → rsvp/unmatched
  ['/${eventCode}/calls/', '/${eventCode}/rsvp/'],
  ['`/${eventCode}/calls/', '`/${eventCode}/rsvp/'],
  // RSVP: rsvp (standalone, not rsvp/) → rsvp/status
  ['/${eventCode}/rsvp`', '/${eventCode}/rsvp/status`'],
  ['/${eventCode}/rsvp?', '/${eventCode}/rsvp/status?'],
  ['/${eventCode}/rsvp"', '/${eventCode}/rsvp/status"'],
  // Logistics section
  ['/${eventCode}/arrivals', '/${eventCode}/logistics/arrivals'],
  ['`/${eventCode}/arrivals', '`/${eventCode}/logistics/arrivals'],
  ['/${eventCode}/departures', '/${eventCode}/logistics/departures'],
  ['`/${eventCode}/departures', '`/${eventCode}/logistics/departures'],
  ['/${eventCode}/fleet', '/${eventCode}/logistics/fleet'],
  ['`/${eventCode}/fleet', '`/${eventCode}/logistics/fleet'],
  // Hospitality 
  ['/${eventCode}/rooms', '/${eventCode}/hospitality/rooms'],
  ['`/${eventCode}/rooms', '`/${eventCode}/hospitality/rooms'],
  ['/${eventCode}/deliveries', '/${eventCode}/hospitality/deliveries'],
  ['`/${eventCode}/deliveries', '`/${eventCode}/hospitality/deliveries'],
  ['/${eventCode}/checkin', '/${eventCode}/hospitality/checkin'],
  ['`/${eventCode}/checkin', '`/${eventCode}/hospitality/checkin'],
  // Guests
  ['/${eventCode}/import`', '/${eventCode}/guests/import`'],
  ['/${eventCode}/import"', '/${eventCode}/guests/import"'],
  ['/${eventCode}/import?', '/${eventCode}/guests/import?'],
  ['/${eventCode}/export`', '/${eventCode}/guests/export`'],
  ['/${eventCode}/export"', '/${eventCode}/guests/export"'],
]

function walk(dir, fn) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry.startsWith('.') || entry === 'node_modules' || entry === '.next') continue
    try {
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full, fn)
      else if (stat.isFile() && (entry.endsWith('.tsx') || entry.endsWith('.ts'))) fn(full)
    } catch (e) {
      // permission errors, skip
    }
  }
}

let fixed = 0
walk(BASE, (file) => {
  let content = readFileSync(file, 'utf8')
  let changed = false
  for (const [from, to] of REPLACEMENTS) {
    const before = content.length
    content = content.split(from).join(to)
    if (content.length !== before) changed = true
  }
  if (changed) {
    writeFileSync(file, content, 'utf8')
    console.log(`FIXED ${file}`)
    fixed++
  }
})

console.log(`\nFixed ${fixed} files.`)
