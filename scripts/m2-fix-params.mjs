// Fix generateStaticParams return types — Next needs typed array, not never[]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let fixed = 0

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'out' || entry === '.next') continue
    try {
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if ((entry === 'page.tsx' || entry === 'layout.tsx') && !full.includes('layout-client')) {
        let content = readFileSync(full, 'utf8')
        if (content.includes("export function generateStaticParams() {\n  return []\n}") ||
            content.includes("export function generateStaticParams() {\r\n  return []\r\n}")) {
          content = content.replace(
            /export function generateStaticParams\(\) \{\s*return \[\]\s*\}/,
            "export function generateStaticParams(): Array<Record<string, string>> {\n  return [{}]\n}"
          )
          writeFileSync(full, content, 'utf8')
          console.log(`FIXED ${full}`)
          fixed++
        }
      }
    } catch { /* skip */ }
  }
}

walk('src/app')
console.log(`\nFixed ${fixed} files.`)
