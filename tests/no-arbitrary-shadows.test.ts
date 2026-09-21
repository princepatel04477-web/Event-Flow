import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function getTsxFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...getTsxFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      files.push(fullPath)
    }
  }

  return files
}

describe('no arbitrary shadows', () => {
  it('ensures no .tsx file in src/ contains arbitrary shadow-[ definitions', () => {
    const srcDir = path.resolve(__dirname, '../src')
    const tsxFiles = getTsxFiles(srcDir)
    const violations: { file: string; line: number; text: string }[] = []

    for (const file of tsxFiles) {
      const content = fs.readFileSync(file, 'utf-8')
      if (content.includes('shadow-[')) {
        const lines = content.split('\n')
        lines.forEach((line, idx) => {
          if (line.includes('shadow-[')) {
            const relPath = path.relative(path.resolve(__dirname, '..'), file)
            violations.push({
              file: relPath,
              line: idx + 1,
              text: line.trim(),
            })
          }
        })
      }
    }

    expect(
      violations,
      `Found arbitrary shadow-[...] in .tsx files:\n${violations
        .map((v) => `  ${v.file}:${v.line}: ${v.text}`)
        .join('\n')}`,
    ).toEqual([])
  })
})
