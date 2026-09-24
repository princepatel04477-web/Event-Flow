/**
 * M34 — the post-import summary must show the counts the action returned.
 *
 * The bug was a placement bug, not a formatting one: the summary was rendered
 * inside a component that unmounts the instant the import succeeds, so the
 * counts were set and destroyed in the same React commit. The placement half
 * is asserted structurally below (the summary has to live in `ImportPreview`,
 * which survives the reset); the mapping half — all four counts, always, from
 * the object the RPC actually returns — is pure and tested directly.
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { batchReference, commitCountsSentence } from '@/lib/import/commit-summary'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const IMPORT_DIR = 'src/app/(staff)/[eventCode]/guests/import/_components'

describe('the import summary sentence (M34)', () => {
  it('shows inserted, updated, skipped and failed, in that order', () => {
    const line = commitCountsSentence({
      inserted: 238,
      updated: 0,
      skipped: 0,
      failed: 4,
      total: 242,
    })

    expect(line).toBe('238 inserted · 0 updated · 0 skipped · 4 failed — 242 total.')

    const order = ['inserted', 'updated', 'skipped', 'failed', 'total']
    const positions = order.map((word) => line.indexOf(word))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('keeps the zeroes rather than omitting them', () => {
    // A second import of the same file is all skips and updates, and a dropped
    // zero reads as "not measured" rather than "none".
    const line = commitCountsSentence({
      inserted: 0,
      updated: 238,
      skipped: 0,
      failed: 0,
      total: 238,
    })
    expect(line).toContain('0 inserted')
    expect(line).toContain('238 updated')
    expect(line).toContain('0 skipped')
    expect(line).toContain('0 failed')
    expect(line).toContain('238 total')
  })

  it('reports the counts it was given, not a total of its own', () => {
    // `total` is the RPC's row count. Deriving it here would silently disagree
    // with the batch the rows were written into.
    const line = commitCountsSentence({
      inserted: 1,
      updated: 2,
      skipped: 3,
      failed: 4,
      total: 99,
    })
    expect(line).toContain('99 total')
  })
})

describe('the batch reference (M34)', () => {
  it('shortens the uuid for reading aloud', () => {
    expect(batchReference('3f2a1b4c-0000-4000-8000-000000000000')).toBe('Batch 3f2a1b4c')
  })

  it('says so when there is no batch id instead of printing "null"', () => {
    expect(batchReference(null)).toBe('Batch reference unavailable')
    expect(batchReference(undefined)).toBe('Batch reference unavailable')
  })
})

describe('where the summary lives (M34)', () => {
  const previewStep = read(`${IMPORT_DIR}/PreviewStep.tsx`)
  const importPreview = read(`${IMPORT_DIR}/ImportPreview.tsx`)

  it('hands the counts UP out of PreviewStep rather than rendering them in it', () => {
    // `PreviewStep` is unmounted by the successful commit, so anything it
    // rendered itself would be destroyed with it.
    expect(previewStep).toContain("onCommitted: (summary: CommitResult['summary']) => void")
    expect(previewStep).toContain('onCommitted(res.summary)')
    expect(previewStep).not.toContain('function CommitSummary')
  })

  it('keeps the counts in ImportPreview, which survives the reset', () => {
    expect(importPreview).toContain('const [summary, setSummary]')
    expect(importPreview).toContain('setSummary(next)')
    expect(importPreview).toContain('<CommitSummary')
    expect(importPreview).toContain('onCommitted={handleCommitted}')
    expect(importPreview).toContain('onDone={() => setSummary(null)}')
  })

  it('resets the preview so the upload step comes back', () => {
    // Both acceptance specs (tier0 T0.2/T0.3) drive the flow by waiting for the
    // "Choose file" button to return, which only happens if the outcome is
    // cleared — hence "keep the counts" can never be "skip the reset".
    const start = importPreview.indexOf('function handleCommitted')
    const handler = importPreview.slice(start, importPreview.indexOf('\n  }\n', start))
    expect(handler).toContain('setOutcome(null)')
  })

  it('offers the guest list as the next step', () => {
    expect(importPreview).toContain('guestListHref')
    expect(read(`${IMPORT_DIR}/CommitSummary.tsx`)).toContain('Go to the guest list')
  })
})
