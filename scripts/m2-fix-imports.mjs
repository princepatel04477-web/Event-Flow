// Clean up remaining server-only imports and stale next/headers/revalidatePath
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let fixed = 0

// 1. Fix action files — remove stale revalidatePath/redirect/notFound imports
const ACTIONS_DIR = join('src', 'lib', 'actions')
for (const file of readdirSync(ACTIONS_DIR)) {
  if (!file.endsWith('.ts')) continue
  const path = join(ACTIONS_DIR, file)
  let content = readFileSync(path, 'utf8')
  let changed = false

  if (content.includes("import { revalidatePath } from 'next/cache'")) {
    content = content.replace(/^import \{ revalidatePath \} from 'next\/cache'\r?\n/m, '')
    changed = true
  }
  if (content.includes("import { redirect } from 'next/navigation'")) {
    content = content.replace(/^import \{ redirect \} from 'next\/navigation'\r?\n/m, '')
    changed = true
  }
  if (content.includes("import { notFound } from 'next/navigation'")) {
    content = content.replace(/^import \{ notFound \} from 'next\/navigation'\r?\n/m, '')
    changed = true
  }
  if (content.includes("import { cookies } from 'next/headers'")) {
    content = content.replace(/^import \{ cookies \} from 'next\/headers'\r?\n/m, '')
    changed = true
  }

  if (changed) {
    writeFileSync(path, content, 'utf8')
    console.log('FIXED', file)
    fixed++
  }
}

// 2. Fix auth.ts — remove stale cookie/URL import
{
  const path = join('src', 'lib', 'actions', 'auth.ts')
  let content = readFileSync(path, 'utf8')
  if (content.includes("import { cookies } from 'next/headers'") ||
      content.includes("import { revalidatePath } from 'next/cache'")) {
    content = content.replace("import { cookies } from 'next/headers'", "// M2: cookies removed — client storage via session-client.ts")
    content = content.replace("import { revalidatePath } from 'next/cache'", '')
    content = content.replace("import { redirect } from 'next/navigation'", '')
    writeFileSync(path, content, 'utf8')
    console.log('FIXED auth.ts (cookie + headers)')
    fixed++
  }
}

// 3. Comment out server-only markers so files can be imported from client bundles
for (const f of [
  'src/lib/auth/claims.ts',
  'src/lib/auth/server.ts',
  'src/lib/supabase/queries.ts',
  'src/lib/supabase/server.ts',
  'src/lib/request-cache.ts',
]) {
  let content = readFileSync(f, 'utf8')
  if (content.startsWith("import 'server-only'")) {
    content = content.replace("import 'server-only'\n", "// M2: 'server-only' removed — static export has no server\n")
    writeFileSync(f, content, 'utf8')
    console.log('FIXED', f)
    fixed++
  }
}

console.log(`\nFixed ${fixed} files.`)
