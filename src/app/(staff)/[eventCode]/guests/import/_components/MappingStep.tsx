'use client'

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { isBlankCell } from '@/lib/import/cells'
import {
  detectContactColumnFromData,
  parseCustomMapping,
  resolveContactsSheet,
  type ContactsParseSuccess,
} from '@/lib/import/contactsSheet'
import type { ParseFamiliesOptions } from '@/lib/import/families'
import type { WorkbookGrids } from '@/lib/import/knownSheet'

export interface MappingStepProps {
  fileName: string
  workbookGrids: WorkbookGrids
  initialSheetName?: string
  initialHeaderRowIndex?: number
  options: ParseFamiliesOptions
  onParsed: (outcome: ContactsParseSuccess & { workbookGrids: WorkbookGrids }) => void
  onCancel: () => void
}

export function MappingStep({
  fileName,
  workbookGrids,
  initialSheetName,
  initialHeaderRowIndex = 0,
  options,
  onParsed,
  onCancel,
}: MappingStepProps) {
  const [selectedSheetName, setSelectedSheetName] = useState<string>(() => {
    if (initialSheetName && workbookGrids.sheetNames.includes(initialSheetName)) {
      return initialSheetName
    }
    return workbookGrids.sheetNames[0] ?? ''
  })

  const currentSheet = useMemo(() => {
    return (
      workbookGrids.sheets.find((s) => s.sheetName === selectedSheetName) ??
      workbookGrids.sheets[0] ?? { sheetName: '', grid: [] }
    )
  }, [workbookGrids, selectedSheetName])

  // Candidate header rows (first 12 rows with non-empty content)
  const candidateHeaderRows = useMemo(() => {
    const candidates: { rowIndex: number; preview: string }[] = []
    const limit = Math.min(currentSheet.grid.length, 12)
    for (let i = 0; i < limit; i++) {
      const row = currentSheet.grid[i] ?? []
      const nonBlank = row.filter((c) => !isBlankCell(c))
      if (nonBlank.length > 0) {
        const preview = nonBlank.slice(0, 4).map((c) => String(c).trim()).join(' | ')
        candidates.push({ rowIndex: i, preview: `Row ${i + 1}: ${preview}` })
      }
    }
    return candidates
  }, [currentSheet])

  const [headerRowIndex, setHeaderRowIndex] = useState<number>(() => {
    if (initialHeaderRowIndex >= 0 && initialHeaderRowIndex < currentSheet.grid.length) {
      return initialHeaderRowIndex
    }
    return candidateHeaderRows[0]?.rowIndex ?? 0
  })

  // Headers extracted from the selected header row
  const headers = useMemo(() => {
    const rawRow = currentSheet.grid[headerRowIndex] ?? []
    return rawRow.map((cell, idx) => {
      if (isBlankCell(cell)) return `(Column ${idx + 1})`
      return String(cell).trim()
    })
  }, [currentSheet, headerRowIndex])

  // Auto-detect best mapping on mount or when header row changes
  const autoMapping = useMemo(() => {
    const res = resolveContactsSheet(headers)
    if (res.ok) {
      let contactIndex = res.sheet.contactIndex
      if (contactIndex === null) {
        contactIndex = detectContactColumnFromData(
          currentSheet.grid,
          headerRowIndex,
          new Set([res.sheet.nameIndex]),
        )
      }
      return {
        nameIndex: res.sheet.nameIndex,
        contactIndex,
        paxIndex: res.sheet.paxIndex ?? null,
        cityIndex: res.sheet.cityIndex ?? null,
        groupCodeIndex: res.sheet.groupCodeIndex ?? null,
        remarksIndex: res.sheet.remarksIndex ?? null,
        roomIndex: res.sheet.roomIndex ?? null,
      }
    }
    const detectedPhone = detectContactColumnFromData(
      currentSheet.grid,
      headerRowIndex,
      new Set([0]),
    )
    return {
      nameIndex: 0,
      contactIndex: detectedPhone,
      paxIndex: null,
      cityIndex: null,
      groupCodeIndex: null,
      remarksIndex: null,
      roomIndex: null,
    }
  }, [headers, currentSheet.grid, headerRowIndex])

  const [nameCol, setNameCol] = useState<number>(() => autoMapping.nameIndex)
  const [contactCol, setContactCol] = useState<number | null>(() => autoMapping.contactIndex)
  const [paxCol, setPaxCol] = useState<number | null>(() => autoMapping.paxIndex)
  const [cityCol, setCityCol] = useState<number | null>(() => autoMapping.cityIndex)
  const [groupCodeCol, setGroupCodeCol] = useState<number | null>(() => autoMapping.groupCodeIndex)
  const [remarksCol, setRemarksCol] = useState<number | null>(() => autoMapping.remarksIndex)

  const [error, setError] = useState<string | null>(null)

  // Handle header row change
  function handleHeaderRowChange(newIndex: number) {
    setHeaderRowIndex(newIndex)
    const newHeaders = (currentSheet.grid[newIndex] ?? []).map((cell, idx) => {
      if (isBlankCell(cell)) return `(Column ${idx + 1})`
      return String(cell).trim()
    })
    const res = resolveContactsSheet(newHeaders)
    if (res.ok) {
      setNameCol(res.sheet.nameIndex)
      let contactIdx = res.sheet.contactIndex
      if (contactIdx === null) {
        contactIdx = detectContactColumnFromData(
          currentSheet.grid,
          newIndex,
          new Set([res.sheet.nameIndex]),
        )
      }
      setContactCol(contactIdx)
      setPaxCol(res.sheet.paxIndex ?? null)
      setCityCol(res.sheet.cityIndex ?? null)
      setGroupCodeCol(res.sheet.groupCodeIndex ?? null)
      setRemarksCol(res.sheet.remarksIndex ?? null)
    } else {
      const detectedPhone = detectContactColumnFromData(
        currentSheet.grid,
        newIndex,
        new Set([0]),
      )
      setContactCol(detectedPhone)
    }
  }

  // Handle sheet change
  function handleSheetChange(newSheet: string) {
    setSelectedSheetName(newSheet)
    const sheet = workbookGrids.sheets.find((s) => s.sheetName === newSheet)
    if (sheet && sheet.grid.length > 0) {
      const firstNonBlank = sheet.grid.findIndex((r) => (r ?? []).some((c) => !isBlankCell(c)))
      const rowIdx = firstNonBlank >= 0 ? firstNonBlank : 0
      setHeaderRowIndex(rowIdx)
      const newHeaders = (sheet.grid[rowIdx] ?? []).map((cell, idx) => {
        if (isBlankCell(cell)) return `(Column ${idx + 1})`
        return String(cell).trim()
      })
      const res = resolveContactsSheet(newHeaders)
      if (res.ok) {
        setNameCol(res.sheet.nameIndex)
        let contactIdx = res.sheet.contactIndex
        if (contactIdx === null) {
          contactIdx = detectContactColumnFromData(
            sheet.grid,
            rowIdx,
            new Set([res.sheet.nameIndex]),
          )
        }
        setContactCol(contactIdx)
        setPaxCol(res.sheet.paxIndex ?? null)
        setCityCol(res.sheet.cityIndex ?? null)
        setGroupCodeCol(res.sheet.groupCodeIndex ?? null)
        setRemarksCol(res.sheet.remarksIndex ?? null)
      } else {
        setNameCol(0)
        const detectedPhone = detectContactColumnFromData(
          sheet.grid,
          rowIdx,
          new Set([0]),
        )
        setContactCol(detectedPhone)
        setPaxCol(null)
        setCityCol(null)
        setGroupCodeCol(null)
        setRemarksCol(null)
      }
    }
  }

  // Sample rows preview (3 rows below header)
  const sampleRows = useMemo(() => {
    const list: unknown[][] = []
    for (let i = headerRowIndex + 1; i < currentSheet.grid.length && list.length < 3; i++) {
      const row = currentSheet.grid[i] ?? []
      if (row.some((c) => !isBlankCell(c))) {
        list.push(row)
      }
    }
    return list
  }, [currentSheet, headerRowIndex])

  function handleApply() {
    if (nameCol === null || nameCol < 0) {
      setError('Please select which column contains the Guest or Family Name.')
      return
    }

    try {
      const parsed = parseCustomMapping(
        currentSheet.grid,
        currentSheet.sheetName,
        headerRowIndex,
        {
          nameIndex: nameCol,
          contactIndex: contactCol,
          paxIndex: paxCol,
          cityIndex: cityCol,
          groupCodeIndex: groupCodeCol,
          remarksIndex: remarksCol,
        },
        options,
      )

      if (!parsed.ok) {
        setError(parsed.reason)
        return
      }

      onParsed({
        ...parsed,
        workbookGrids,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not parse with this column mapping.')
    }
  }

  const columnOptions = headers.map((h, i) => ({
    value: String(i),
    label: `${h} (Column ${i + 1})`,
  }))

  const optionalColumnOptions = [
    { value: '-1', label: '— None —' },
    ...columnOptions,
  ]

  return (
    <Card>
      <CardBody className="flex flex-col gap-5 p-5">
        <div>
          <h3 className="text-base font-semibold text-fg">Map your spreadsheet columns</h3>
          <p className="mt-1 text-sm text-muted">
            <span className="font-medium text-fg">{fileName}</span> · Match the columns from your
            sheet with the fields below. Only <span className="font-medium text-fg">Guest Name</span>{' '}
            is required.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger"
          >
            {error}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {workbookGrids.sheetNames.length > 1 ? (
            <Select
              label="Sheet / Tab"
              value={selectedSheetName}
              onChange={(e) => handleSheetChange(e.target.value)}
              options={workbookGrids.sheetNames.map((s) => ({ value: s, label: s }))}
            />
          ) : null}

          <Select
            label="Header row"
            value={String(headerRowIndex)}
            onChange={(e) => handleHeaderRowChange(Number(e.target.value))}
            options={candidateHeaderRows.map((c) => ({
              value: String(c.rowIndex),
              label: c.preview,
            }))}
          />
        </div>

        <div className="rounded-xl border border-border bg-paper/50 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Column Assignments
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Guest / Family Name *"
              hint="Required. Each row with a name becomes a guest or family."
              value={String(nameCol)}
              onChange={(e) => {
                setNameCol(Number(e.target.value))
                setError(null)
              }}
              options={columnOptions}
            />

            <Select
              label="Phone / Mobile Number"
              hint="Optional. 10-digit Indian numbers will be dialable."
              value={contactCol !== null ? String(contactCol) : '-1'}
              onChange={(e) => {
                const val = Number(e.target.value)
                setContactCol(val >= 0 ? val : null)
              }}
              options={optionalColumnOptions}
            />

            <Select
              label="Number of Guests (Pax)"
              hint="Optional. Defaults to 1 if not present."
              value={paxCol !== null ? String(paxCol) : '-1'}
              onChange={(e) => {
                const val = Number(e.target.value)
                setPaxCol(val >= 0 ? val : null)
              }}
              options={optionalColumnOptions}
            />

            <Select
              label="City / Place"
              hint="Optional. Native place or hometown."
              value={cityCol !== null ? String(cityCol) : '-1'}
              onChange={(e) => {
                const val = Number(e.target.value)
                setCityCol(val >= 0 ? val : null)
              }}
              options={optionalColumnOptions}
            />

            <Select
              label="Group / Family Code"
              hint="Optional. Used to group or number families."
              value={groupCodeCol !== null ? String(groupCodeCol) : '-1'}
              onChange={(e) => {
                const val = Number(e.target.value)
                setGroupCodeCol(val >= 0 ? val : null)
              }}
              options={optionalColumnOptions}
            />

            <Select
              label="Remarks / Notes"
              hint="Optional. Free text remarks."
              value={remarksCol !== null ? String(remarksCol) : '-1'}
              onChange={(e) => {
                const val = Number(e.target.value)
                setRemarksCol(val >= 0 ? val : null)
              }}
              options={optionalColumnOptions}
            />
          </div>
        </div>

        {sampleRows.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Preview with selected columns (first {sampleRows.length} rows)
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-tint-neutral/50 font-medium text-fg">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Pax</th>
                    <th className="px-3 py-2">City</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sampleRows.map((row, idx) => {
                    const name = nameCol >= 0 ? String(row[nameCol] ?? '') : ''
                    const phone = contactCol !== null && contactCol >= 0 ? String(row[contactCol] ?? '') : ''
                    const pax = paxCol !== null && paxCol >= 0 ? String(row[paxCol] ?? '1') : '1'
                    const city = cityCol !== null && cityCol >= 0 ? String(row[cityCol] ?? '') : ''
                    return (
                      <tr key={idx} className="hover:bg-tint-neutral/20">
                        <td className="px-3 py-2 font-medium text-fg">{name || '—'}</td>
                        <td className="px-3 py-2 text-muted">{phone || '—'}</td>
                        <td className="px-3 py-2 text-muted">{pax || '1'}</td>
                        <td className="px-3 py-2 text-muted">{city || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
          <Button type="button" size="lg" fullWidth onClick={handleApply}>
            Continue to Preview
          </Button>
          <Button type="button" variant="secondary" size="lg" fullWidth onClick={onCancel}>
            Choose a different file
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

export default MappingStep
