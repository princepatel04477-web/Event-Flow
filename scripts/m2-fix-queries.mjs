// Fix: Replace all server import chains with client equivalents
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let fixed = 0

// Replacements: server import → client import
const REPLACEMENTS = [
  ["import { getEventAccess, getViewer, resolveEventByCode } from '@/lib/supabase/queries'",
   "import { getEventAccessClient, getViewerClient, resolveEventByCodeClient } from '@/lib/supabase/queries-client'"],
  ["import { getSessionClaims } from '@/lib/auth/server'",
   "import { readSessionClaims } from '@/lib/auth/session-client'"],
]

const TARGET_DIRS = [join('src', 'lib', 'actions')]

for (const dir of TARGET_DIRS) {
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
    const path = join(dir, file)
    let content = readFileSync(path, 'utf8')
    let changed = false

    for (const [from, to] of REPLACEMENTS) {
      if (content.includes(from)) {
        content = content.replace(from, to)
        changed = true
      }
    }

    // Also fix internal calls if the imports changed
    if (content.includes('getEventAccessClient')) {
      content = content.replace(/getEventAccess\(/g, 'getEventAccessClient(')
      content = content.replace(/resolveEventByCode\(/g, 'resolveEventByCodeClient(')
      content = content.replace(/getViewer\(/g, 'getViewerClient(')
      content = content.replace(/getSessionClaims\(/g, 'readSessionClaims(')
      changed = true
    }

    if (changed) {
      writeFileSync(path, content, 'utf8')
      console.log('FIXED', file)
      fixed++
    }
  }
}

// Also fix src/lib/auth/codes.ts — may import from server
for (const f of ['src/lib/auth/codes.ts']) {
  let content = readFileSync(f, 'utf8')
  if (content.includes("from '@/lib/supabase/server'")) {
    content = content.replace("from '@/lib/supabase/server'", "from '@/lib/supabase/client'")
    content = content.replace(/createClient\(\)/g, 'supabase')
    writeFileSync(f, content, 'utf8')
    console.log('FIXED', f)
    fixed++
  }
}

console.log(`\nFixed ${fixed} files.`)
