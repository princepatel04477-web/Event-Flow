'use client'

import { useMemo } from 'react'

import { ChevronDownIcon } from '@/components/icons'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { groupWarnings, type ImportWarning, type ImportWarningSeverity } from '@/lib/import/families'

export interface WarningsListProps {
  warnings: ImportWarning[]
}

const SEVERITY_TONE: Record<ImportWarningSeverity, BadgeTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'neutral',
}

const SEVERITY_LABEL: Record<ImportWarningSeverity, string> = {
  critical: 'Blocks a family',
  warning: 'Data left blank',
  info: 'Changed quietly',
}

/**
 * Everything the parser decided for itself, grouped by KIND.
 *
 * This is the part of the screen the human actually reads, and 300 warnings
 * rendered as one flat list is 300 sentences nobody finishes on a phone.
 * Grouping by kind turns it into a dozen lines — "Phone number could not be
 * read: 6" — each of which expands to the rows behind it. A kind with a count
 * of 1 is noise; a kind with a count of 40 is a column that was filled in
 * wrong, and that is a different conversation.
 *
 * Every entry names the family, the sheet row, the column, the cell verbatim
 * and what was done with it, because the fix happens in Excel and the operator
 * has to be able to find the cell.
 */
export function WarningsList({ warnings }: WarningsListProps) {
  const groups = useMemo(() => groupWarnings(warnings), [warnings])

  if (groups.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-success">
            No warnings. Every cell in this sheet read cleanly.
          </p>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">Warnings</span>
          <span className="text-sm text-muted">
            {warnings.length} across {groups.length} kind{groups.length === 1 ? '' : 's'}
          </span>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col divide-y divide-border p-0">
        {groups.map((group) => (
          <details
            key={group.code}
            className="group"
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 60px' }}
          >
            <summary className="tap flex min-h-[3.25rem] cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">{group.label}</span>
                <span className="text-xs text-subtle">{SEVERITY_LABEL[group.severity]}</span>
              </span>
              <Badge tone={SEVERITY_TONE[group.severity]}>{group.count}</Badge>
              <ChevronDownIcon
                className="h-4 w-4 shrink-0 text-subtle transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>

            <ul className="flex flex-col divide-y divide-border border-t border-border bg-surface-2">
              {group.warnings.map((w, i) => (
                <li key={`${w.sheetRowNumber}-${w.field}-${i}`} className="px-4 py-2.5">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-subtle">
                    <span className="font-semibold tabular-nums text-muted">
                      Row {w.sheetRowNumber}
                    </span>
                    {w.familyNumber ? <span>family #{w.familyNumber}</span> : <span>no family</span>}
                    <span>·</span>
                    <span>{w.field}</span>
                  </p>
                  {w.rawValue ? (
                    <p className="mt-0.5 truncate font-mono text-sm text-fg">“{w.rawValue}”</p>
                  ) : (
                    <p className="mt-0.5 text-sm italic text-subtle">(cell was empty)</p>
                  )}
                  <p className="mt-0.5 text-sm leading-snug text-muted">{w.action}</p>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </CardBody>
    </Card>
  )
}

export default WarningsList
