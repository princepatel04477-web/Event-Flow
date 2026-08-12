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
        if (content.includes('generateStaticParams(): ')) continue // already fixed
        
        // Remove old bare version
        content = content.replace(/export function generateStaticParams\(\) \{\s*return \[\]\s*\}/g, '').trim()
        
        // Add after the last import statement
        const lines = content.split('\n')
        let lastImport = 0
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim().startsWith('import ') || lines[i].trim().startsWith('export const metadata') || lines[i].trim() === '') {
            lastImport = i
          }
        }
        lines.splice(lastImport + 1, 0, '', 'export function generateStaticParams(): Array<Record<string, string>> {', '  return [{}]', '}', '')
        content = lines.join('\n')
        
        writeFileSync(full, content, 'utf8')
        console.log(`FIXED ${full}`)
        fixed++
      }
    } catch (e) { /* skip */ }
  }
}

walk('src/app')
console.log(`\nFixed ${fixed} new files.`)
