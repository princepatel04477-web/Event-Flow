// Replace all generateStaticParams return [{}] with return []
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
      else if (entry === 'page.tsx' || entry === 'layout.tsx') {
        let content = readFileSync(full, 'utf8')
        if (content.includes("return [{}]")) {
          content = content.replace(/return \[\{\}\]/g, 'return []')
          writeFileSync(full, content, 'utf8')
          console.log('FIXED ' + full)
          fixed++
        }
      }
    } catch {}
  }
}
walk('src/app')
console.log('\nFixed ' + fixed + ' files.')
