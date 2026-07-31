'use client'

import { Card, CardBody } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { IMPORT_FIELDS, type ColumnMapping, type ImportFieldKey } from '@/lib/import/mapper'

export interface MapStepProps {
  sheetName: string
  headers: (string | null)[]
  rowCount: number
  mapping: ColumnMapping
  onChange: (mapping: ColumnMapping) => void
}

/** Step 2: confirm (or correct) which sheet column feeds which field. */
export function MapStep({ sheetName, headers, rowCount, mapping, onChange }: MapStepProps) {
  function setField(key: ImportFieldKey, raw: string) {
    const next = { ...mapping }
    if (raw === '') {
      delete next[key]
    } else {
      next[key] = Number(raw)
    }
    onChange(next)
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Sheet <span className="font-medium text-fg">&quot;{sheetName}&quot;</span> — {rowCount}{' '}
          data row{rowCount === 1 ? '' : 's'} found. Match each field to a column below.
        </p>

        {IMPORT_FIELDS.map((field) => (
          <Select
            key={field.key}
            label={field.label}
            hint={field.hint}
            required={field.required}
            value={mapping[field.key] !== undefined ? String(mapping[field.key]) : ''}
            onChange={(e) => setField(field.key, e.target.value)}
          >
            <option value="">{field.required ? 'Choose a column…' : '— not mapped —'}</option>
            {headers.map((h, i) => (
              <option key={i} value={i}>
                {h ?? `Column ${i + 1}`}
              </option>
            ))}
          </Select>
        ))}
      </CardBody>
    </Card>
  )
}

export default MapStep
