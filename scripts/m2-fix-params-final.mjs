// Final fix: all dynamic pages → empty generateStaticParams
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
        const hasGsp = content.includes('generateStaticParams')
        content = content.replace(/export function generateStaticParams\(\): Array<Record<string, string>> \{\n  return \[\{\}\]\n\}/g, '')
        content = content.replace(/export function generateStaticParams\(\) \{\n  return \[\]\n\}/g, '')
        // Always add fresh version after the last import
        const lines = content.split('\n')
        let insertAt = 0
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim()
          if (t.startsWith('import ') || t.startsWith('export const metadata') || t === '' || t.startsWith('//')) {
            insertAt = i
          }
        }
        const gspBlock = hasGsp ? '' : '\nexport function generateStaticParams(): never[] {\n  return []\n}\n'
        if (gspBlock) {
          lines.splice(insertAt + 1, 0, gspBlock)
          writeFileSync(full, lines.join('\n'), 'utf8')
          console.log(`FIXED ${full}`)
          fixed++
        }
      }
    } catch {}
  }
}

walk('src/app')
console.log(`\nFixed ${fixed} new files.`)
