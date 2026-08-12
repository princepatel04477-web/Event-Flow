// Convert server actions to client actions for M2 static export
// Mechanical changes: remove 'use server', swap Supabase client import,
// remove server-side-only calls (revalidatePath, redirect, notFound)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ACTIONS_DIR = join('src', 'lib', 'actions')
let converted = 0

for (const file of readdirSync(ACTIONS_DIR)) {
  if (!file.endsWith('.ts')) continue
  const path = join(ACTIONS_DIR, file)
  let content = readFileSync(path, 'utf8')
  let changed = false

  // 1. Remove 'use server'
  if (content.includes("'use server'")) {
    content = content.replace(/^'use server'\r?\n\r?\n?/m, '')
    changed = true
  }

  // 2. Swap server client import to shared client import
  if (content.includes("import { createClient } from '@/lib/supabase/server'")) {
    content = content.replace(
      "import { createClient } from '@/lib/supabase/server'",
      "import { supabase } from '@/lib/supabase/client'"
    )
    content = content.replace(/const supabase = await createClient\(\)/g, '// supabase client injected above')
    changed = true
  }

  // 3. Remove revalidatePath calls (client doesn't have this)
  if (content.includes('revalidatePath(')) {
    content = content.replace(/^\s*revalidatePath\(.*\);?\s*$/gm, '')
    changed = true
  }

  // 4. Remove redirect calls (replaced by router.push in caller)
  if (content.includes('redirect(')) {
    content = content.replace(/^\s*redirect\(.*\);?\s*$/gm, '// FIXME M2: caller must navigate with router.push')
    changed = true
  }

  // 5. Remove notFound() calls (not available client-side)
  if (content.includes('notFound()')) {
    content = content.replace(/^\s*notFound\(\);?\s*$/gm, '// FIXME M2: caller must handle 404 state')
    changed = true
  }

  if (changed) {
    writeFileSync(path, content, 'utf8')
    console.log(`CONVERTED ${file}`)
    converted++
  } else {
    console.log(`SKIP     ${file} (no changes needed)`)
  }
}

console.log(`\nConverted ${converted} files. Review FIXME markers for manual follow-up.`)
