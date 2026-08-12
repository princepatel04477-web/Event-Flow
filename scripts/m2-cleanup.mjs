// Clean up stale comments from the mechanical conversion
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ACTIONS_DIR = join('src', 'lib', 'actions')

for (const file of readdirSync(ACTIONS_DIR)) {
  if (!file.endsWith('.ts')) continue
  const path = join(ACTIONS_DIR, file)
  let content = readFileSync(path, 'utf8')
  let changed = false

  // Remove stale "supabase client injected above" comments
  if (content.includes('// supabase client injected above')) {
    content = content.replace(/\n\s*\/\/ supabase client injected above/g, '')
    changed = true
  }

  if (changed) {
    writeFileSync(path, content, 'utf8')
    console.log(`CLEANED ${file}`)
  }
}
console.log('done')
