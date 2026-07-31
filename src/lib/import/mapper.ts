/**
 * Column mapping for Excel import.
 *
 * The sheet is never hardcoded to fixed columns - the calling-list workbook
 * will change, and a second event will bring an entirely different one.
 * `autoDetectMapping` offers a best-effort guess by fuzzy-matching header
 * text; the user confirms or corrects it before anything is parsed further.
 */

export type ImportFieldKey =
  | 'group_code'
  | 'head_name'
  | 'primary_mobile'
  | 'alt_mobile'
  | 'expected_pax'
  | 'side'
  | 'group_type'
  | 'city'
  | 'remarks'
  | 'needs_return_gift'

export interface ImportFieldDef {
  key: ImportFieldKey
  label: string
  required: boolean
  hint?: string
}

export const IMPORT_FIELDS: ImportFieldDef[] = [
  { key: 'head_name', label: 'Head / family name', required: true },
  { key: 'group_code', label: 'Group code', required: false },
  {
    key: 'primary_mobile',
    label: 'Primary mobile',
    required: false,
    hint: 'A number that cannot be read as 10 digits still imports - it just cannot be called yet.',
  },
  { key: 'alt_mobile', label: 'Alternate mobile', required: false },
  { key: 'expected_pax', label: 'Expected pax', required: false },
  { key: 'side', label: 'Side (bride / groom)', required: false },
  { key: 'group_type', label: 'Group type', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'remarks', label: 'Remarks', required: false },
  { key: 'needs_return_gift', label: 'Needs return gift', required: false },
]

/** Column index (into the header row) for each mapped field. Unset = unmapped. */
export type ColumnMapping = Partial<Record<ImportFieldKey, number>>

const ALIASES: Record<ImportFieldKey, string[]> = {
  group_code: [
    'group code',
    'groupcode',
    'family code',
    'family id',
    'group id',
    'group no',
    'family no',
    'sr no',
    'sr. no',
    'srno',
    'code',
  ],
  head_name: [
    'head name',
    'family head',
    'head of family',
    'guest name',
    'family name',
    'contact name',
    'name',
  ],
  primary_mobile: [
    'primary mobile',
    'mobile no',
    'mobile number',
    'contact number',
    'contact no',
    'phone number',
    'whatsapp number',
    'whatsapp',
    'mobile',
    'phone',
  ],
  alt_mobile: [
    'alternate mobile',
    'alternative mobile',
    'secondary mobile',
    'alt mobile',
    'alt contact',
    'alt no',
    'other number',
  ],
  expected_pax: [
    'expected pax',
    'no of pax',
    'no. of guests',
    'number of guests',
    'total pax',
    'group size',
    'headcount',
    'members',
    'people',
    'pax',
  ],
  side: ['bride/groom', 'bride or groom', 'side'],
  group_type: ['group type', 'family type', 'category', 'type'],
  city: ['from city', 'native place', 'location', 'town', 'city'],
  remarks: ['rsvp remarks', 'status remark', 'comments', 'remark', 'remarks', 'notes'],
  needs_return_gift: [
    'return gift required',
    'needs return gift',
    'return gift',
    'gift required',
    'gift',
    'rg',
  ],
}

function normaliseHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[_\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Best-effort column guess for each field from the sheet's raw header text.
 * Exact alias matches win outright; otherwise the longest alias found as a
 * substring wins, so e.g. "primary mobile" beats "mobile" on a header that
 * contains both.
 */
export function autoDetectMapping(headers: (string | null)[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const normalised = headers.map((h) => (h ? normaliseHeader(h) : ''))
  const claimed = new Set<number>()

  for (const field of IMPORT_FIELDS) {
    const aliases = ALIASES[field.key]
    let bestIndex = -1
    let bestScore = 0

    normalised.forEach((header, index) => {
      if (!header || claimed.has(index)) return

      if (aliases.includes(header)) {
        // Exact match always wins, and wins immediately over a longer but
        // partial match found on an earlier column.
        if (bestScore < 1000) {
          bestScore = 1000
          bestIndex = index
        }
        return
      }

      for (const alias of aliases) {
        if (header.includes(alias) && alias.length > bestScore) {
          bestScore = alias.length
          bestIndex = index
        }
      }
    })

    if (bestIndex >= 0) {
      mapping[field.key] = bestIndex
      claimed.add(bestIndex)
    }
  }

  return mapping
}
