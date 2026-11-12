/**
 * The client calling-list shape (first seen: the 11–12 Feb Ujjain groom list).
 *
 *   Names | Relation | Adult | Kids | City | Calling Number | Whatsapp Number
 *   "Father Side"                      <- a heading row, not a guest
 *   ...guests...
 *   "Mother Side"
 *   ...guests...
 *
 * Every fixture here is synthetic — no real guest names or numbers in the repo.
 */
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { isTotalsRow, sectionHeading, splitMobiles } from '@/lib/import/contactsSheet'
import { parseImportFile } from '@/lib/import/knownSheet'

const OPTS = { eventStartsOn: '2027-02-11', eventEndsOn: '2027-02-12', defaultSide: null, defaultSubSide: null }

function workbookFile(
  sheetName: string,
  rows: unknown[][],
  notes: Record<string, string> = {},
): File {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  for (const [addr, text] of Object.entries(notes)) {
    ws[addr] = ws[addr] ?? { t: 's', v: '' }
    ws[addr].c = [{ a: '', t: text }]
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([buf], 'list.xlsx')
}

const HEADER = ['Names ', 'Relation', 'Adult', 'Kids', 'City ', 'Calling Number', 'Whatsapp Number']

async function parse(rows: unknown[][], notes?: Record<string, string>, sheetName = 'Groom_Invitation_List') {
  const outcome = await parseImportFile(workbookFile(sheetName, rows, notes), OPTS)
  if (!outcome.ok) throw new Error(`did not parse: ${JSON.stringify(outcome).slice(0, 300)}`)
  return outcome
}

describe('client calling-list layout', () => {
  it('dials the Calling Number column, keeping WhatsApp as the alternate', async () => {
    const o = await parse([
      HEADER,
      ['Asha Test', 'Sister', 1, null, 'Pune', 9000000001, 9000000002],
      ['Bimal Test', 'Friend', 1, null, 'Pune', 9000000003, null],
    ])
    const [a, b] = o.result.families
    expect(a.primaryMobile).toBe('9000000001')
    expect(a.altMobile).toBe('9000000002')
    expect(b.primaryMobile).toBe('9000000003')
    expect(b.altMobile).toBeNull()
  })

  it('falls back to the WhatsApp number when the calling cell is blank', async () => {
    const o = await parse([HEADER, ['Chetan Test', 'Uncle', 1, null, 'Pune', null, 9000000004]])
    expect(o.result.families[0].primaryMobile).toBe('9000000004')
    expect(o.result.families[0].warnings).toEqual([])
  })

  it('splits two numbers typed into one cell', async () => {
    const o = await parse([HEADER, ['Divya Test', 'Didi', 2, null, 'Jaipur', '9000000005, 9000000006', null]])
    expect(o.result.families[0].primaryMobile).toBe('9000000005')
    expect(o.result.families[0].altMobile).toBe('9000000006')
  })

  it('adds Adult and Kids into pax, and flags a blank headcount', async () => {
    const o = await parse([
      HEADER,
      ['Esha Test', 'Didi', 6, 3, 'Jaipur', 9000000007, null],
      ['Farid Test', 'Bhatija', null, null, 'Delhi', 9000000008, null],
    ])
    expect(o.result.families[0].expectedPax).toBe(9)
    expect(o.result.families[1].expectedPax).toBe(1)
    expect(o.result.families[1].warnings.map((w) => w.code)).toEqual(['pax_missing'])
  })

  it('reads Father Side / Mother Side heading rows as sections, not guests', async () => {
    const o = await parse([
      HEADER,
      ['Father Side', null, null, null, null, null, null],
      ['Gita Test', 'Brother', 1, null, 'Surat', 9000000009, null],
      [null, null, null, null, null, null, null],
      ['Mother Side', null, null, null, null, null, null],
      ['Hari Test', 'Mama', 1, null, 'Surat', 9000000010, null],
    ])
    const fams = o.result.families
    expect(fams.map((f) => f.headName)).toEqual(['Gita Test', 'Hari Test'])
    // the tab name "Groom_Invitation_List" supplies the side
    expect(fams.map((f) => [f.side, f.subSide])).toEqual([
      ['groom', 'father'],
      ['groom', 'mother'],
    ])
    expect(fams.map((f) => f.familyNumber)).toEqual(['1', '2'])
  })

  it('folds relation and Excel cell notes into the remark the caller sees', async () => {
    const o = await parse(
      [HEADER, ['Indu Test', 'Didi , Jijaji', 2, null, 'Jaipur', 9000000011, 9000000012]],
      { A2: 'Call Both', G2: 'Indu Ji' },
    )
    expect(o.result.families[0].remark).toBe('Relation: Didi , Jijaji · Call Both · Whatsapp Number: Indu Ji')
  })

  it('skips subtotal and grand-total rows', async () => {
    const o = await parse([
      ['Sr. No.', 'Names', 'Relation', 'Adult', 'Kids', 'Total', 'City', 'Calling Number', 'Whatsapp Number', 'Remarks / Notes'],
      ['FATHER SIDE', null, null, null, null, null, null, null, null, null],
      [1, 'Jai Test', 'Brother', 2, 1, 3, 'Surat', 9000000013, null, 'Call Via Botim'],
      [null, 'Father Side Subtotal', 1, 2, 1, 3, null, null, null, null],
      [null, 'GRAND TOTAL (ALL GUESTS)', 1, 2, 1, 3, null, null, null, null],
    ])
    const fams = o.result.families
    expect(fams).toHaveLength(1)
    expect(fams[0]).toMatchObject({ headName: 'Jai Test', expectedPax: 3, familyNumber: '1', subSide: 'father' })
    expect(fams[0].remark).toBe('Relation: Brother · Call Via Botim')
  })
})

describe('helpers', () => {
  it('splitMobiles never guesses', () => {
    expect(splitMobiles('9000000001 / 9000000002').numbers).toEqual(['9000000001', '9000000002'])
    expect(splitMobiles('9000000001 or +91 90000 00002').numbers).toEqual(['9000000001', '9000000002'])
    expect(splitMobiles('90000000019000000002')).toEqual({ numbers: [], reason: expect.any(String) })
    expect(splitMobiles(null)).toEqual({ numbers: [], reason: null })
  })

  it('sectionHeading needs a lone cell that says "side"', () => {
    expect(sectionHeading(['Bride Side', null])).toEqual({ text: 'Bride Side', side: 'bride', subSide: null })
    expect(sectionHeading(["Groom's Mother Side"])).toMatchObject({ side: 'groom', subSide: 'mother' })
    expect(sectionHeading(['Papa Ji', null])).toBeNull()
    expect(sectionHeading(['Father Side', 'Surat'])).toBeNull()
  })

  it('isTotalsRow', () => {
    expect(isTotalsRow('Mother Side Subtotal')).toBe(true)
    expect(isTotalsRow('Total')).toBe(true)
    expect(isTotalsRow('Totaram Test')).toBe(false)
  })
})
