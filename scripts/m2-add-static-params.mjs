import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let added = 0

function hasDynamicParent(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts.some(p => p.startsWith('[') && p.endsWith(']'))
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'out' || entry === '.next') continue
    try {
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (entry === 'page.tsx' && hasDynamicParent(full)) {
        let content = readFileSync(full, 'utf8')
        if (content.includes('generateStaticParams')) continue
        if (!content.includes('export default')) continue

        content = content.replace(
          /^(export default (async )?function \w+)/m,
          `export function generateStaticParams() {\n  return []\n}\n\n$1`
        )
        writeFileSync(full, content, 'utf8')
        console.log(`ADDED ${full}`)
        added++
      }
    } catch { /* skip */ }
  }
}

walk('src/app')
console.log(`\nAdded generateStaticParams to ${added} pages.`)
