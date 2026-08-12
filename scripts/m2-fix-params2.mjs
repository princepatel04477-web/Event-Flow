// Robust fix: add generateStaticParams to EVERY page.tsx under a dynamic route
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let fixed = 0

function hasDynamicParent(filePath) {
  return filePath.replace(/\\/g, '/').split('/').some(p => p.startsWith('[') && p.endsWith(']'))
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
        if (content.includes('generateStaticParams(): Array')) continue // already fixed
        
        // Remove the old bare version if it exists
        content = content.replace(
          /export function generateStaticParams\(\) \{\s*return \[\]\s*\}/g,
          ''
        )

        // Insert at the top after imports, before any export
        content = content.replace(
          /^(\s*\n)*(?!\/\/|import|export)/m,
          `\n\nexport function generateStaticParams(): Array<Record<string, string>> {\n  return [{}]\n}\n`
        )
        writeFileSync(full, content, 'utf8')
        console.log(`FIXED ${full}`)
        fixed++
      }
    } catch (e) { 
      // skip 
    }
  }
}

walk('src/app')
console.log(`\nFixed ${fixed} files.`)
