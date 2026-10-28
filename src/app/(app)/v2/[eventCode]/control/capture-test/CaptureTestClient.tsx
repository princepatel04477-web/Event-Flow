'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardTitle } from '@/components/ui/Card'
import { runHarvestSelfTest, type SelfTestReport, type StepState } from '@/lib/harvest-selftest'

/**
 * The per-handset capture test.
 *
 * Reachable by STAFF, which is the whole point. The harvest debug screen lives
 * under `(admin)`, so a code-auth session — every phone on the floor — cannot
 * open it (CLAUDE.md §12, the SECTIONS roles trap). A device test that only
 * the developer's own login can run tests the one device that was never in
 * doubt.
 */

const TONE: Record<StepState, string> = {
  pass: 'text-success',
  fail: 'text-danger',
  warn: 'text-warning',
  skip: 'text-muted',
}

const MARK: Record<StepState, string> = {
  pass: 'OK',
  fail: 'NO',
  warn: '!',
  skip: '–',
}

export function CaptureTestClient({ eventId }: { eventId: string }) {
  const [report, setReport] = useState<SelfTestReport | null>(null)
  const [running, setRunning] = useState(false)
  const [crashed, setCrashed] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setCrashed(null)
    try {
      setReport(await runHarvestSelfTest(eventId))
    } catch (err) {
      setCrashed(err instanceof Error ? err.message : 'The test did not finish.')
    } finally {
      setRunning(false)
    }
  }

  /** Everything on screen, as text — so a staff member can paste it into chat. */
  function asText(r: SelfTestReport): string {
    const lines = [`capture test — ${r.verdict}`]
    for (const s of r.steps) {
      lines.push(`[${MARK[s.state]}] ${s.title}: ${s.detail.replace(/\n/g, ' / ')}`)
    }
    if (r.files.length > 0) {
      lines.push('files:')
      for (const f of r.files.slice(0, 10)) lines.push(`  ${f.name} (${f.size}b)`)
    }
    return lines.join('\n')
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-3">
          <CardTitle>Does call capture work on this phone?</CardTitle>
          <p className="text-sm text-muted">
            Runs the real check — the same folder search, file read and family match that
            automatic capture uses — and stops before uploading anything. Nothing is sent and
            nothing is saved.
          </p>
          <p className="text-sm text-muted">
            Make one short call with recording switched on first, otherwise there is nothing to
            test against.
          </p>
          <Button variant="primary" onClick={() => void run()} disabled={running}>
            {running ? 'Checking…' : 'Run the check'}
          </Button>
        </CardBody>
      </Card>

      {crashed ? (
        <Card>
          <CardBody>
            <p className="text-sm text-danger">{crashed}</p>
          </CardBody>
        </Card>
      ) : null}

      {report ? (
        <>
          <Card>
            <CardBody className="flex flex-col gap-3">
              <CardTitle>
                {report.verdict === 'ready'
                  ? 'This phone can capture calls'
                  : report.verdict === 'blocked'
                    ? 'This phone cannot capture calls yet'
                    : 'Not enough to tell yet'}
              </CardTitle>

              {report.steps.map((s) => (
                <div key={s.id} className="flex gap-3">
                  <span className={`w-8 shrink-0 text-sm font-semibold ${TONE[s.state]}`}>
                    {MARK[s.state]}
                  </span>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-fg">{s.title}</p>
                    <p className="whitespace-pre-wrap break-words text-sm text-muted">
                      {s.detail}
                    </p>
                    {s.fix ? <p className="text-sm text-warning">{s.fix}</p> : null}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>

          {report.files.length > 0 ? (
            <Card>
              <CardBody className="flex flex-col gap-2">
                <CardTitle>What is on this phone</CardTitle>
                {/* The filenames ARE the diagnostic: whether capture can tie a
                    recording to a family comes down to what the dialer names
                    its files. */}
                {report.files.slice(0, 10).map((f) => (
                  <p key={f.path} className="break-all text-sm text-muted">
                    {f.name}{' '}
                    <span className="text-subtle">({f.size.toLocaleString()} bytes)</span>
                  </p>
                ))}
              </CardBody>
            </Card>
          ) : null}

          <Button
            variant="secondary"
            onClick={() => void navigator.clipboard?.writeText(asText(report))}
          >
            Copy the result
          </Button>
        </>
      ) : null}
    </div>
  )
}

export default CaptureTestClient
