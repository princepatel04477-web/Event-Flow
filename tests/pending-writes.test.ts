/**
 * M41 — a rejected server action must not leave a submit control dead.
 *
 * The failure this pins down is invisible to every other check in the repo: a
 * dropped connection makes a server action REJECT rather than return, the
 * `catch` was missing, so `setSubmitting(false)` never ran and the button read
 * "Creating…" / "Saving…" / "Sending…" for the rest of the session. Nothing
 * threw where a test could see it, and `npx tsc --noEmit` is perfectly happy
 * with an uncaught await.
 *
 * Two halves:
 *
 *  1. the house sentence itself — it must say the write may or may not have
 *     landed and must name a place to check, because "the change failed" is a
 *     lie whenever the request died after the insert committed;
 *  2. every one of the seven call sites must actually use it, from inside a
 *     `catch`, with the pending flag cleared in a `finally`.
 *
 * The second half reads source, deliberately and in the same spirit as
 * `tests/phone-layout.test.ts`: these are structural facts about components
 * that cannot be rendered in a node-environment test, and an assertion a
 * future edit can break loudly is worth more than no assertion at all.
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { lostResponseMessage } from '@/lib/errors'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

/** The admin event tree, spelled once. */
const EVENTS = 'src/app/(admin)/admin/events/[eventCode]'

/**
 * Each file, the awaited server-action call that used to be uncaught, and
 * whether the site has a pending flag that must be cleared in a `finally`.
 */
const WRITE_SITES = [
  {
    file: `${EVENTS}/hotels/[hotelId]/rooms/_components/RoomCreateForm.tsx`,
    anchor: 'await createRooms(',
    clearInFinally: true,
  },
  {
    file: `${EVENTS}/hotels/[hotelId]/rooms/[roomId]/_components/RoomEditClient.tsx`,
    anchor: 'await updateRoom(',
    clearInFinally: true,
  },
  {
    file: `${EVENTS}/hotels/[hotelId]/_components/HotelDetailClient.tsx`,
    anchor: 'await updateHotel(',
    clearInFinally: true,
  },
  {
    file: `${EVENTS}/ArchiveEventCard.tsx`,
    anchor: 'await archiveEvent(',
    clearInFinally: true,
  },
  {
    file: `${EVENTS}/messages/SendClient.tsx`,
    anchor: 'await sendMessages(',
    // The phase machine leaves 'sending' on both paths, so there is no
    // separate flag left to clear and no `finally` to clear it in.
    clearInFinally: false,
  },
  {
    file: `${EVENTS}/messages/log/LogClient.tsx`,
    anchor: 'await retryMessage(',
    clearInFinally: true,
  },
  {
    file: `${EVENTS}/HotelImporter.tsx`,
    anchor: 'await commitHotelImport(',
    clearInFinally: true,
  },
] as const

describe('the sentence a rejected write gets (M41)', () => {
  const message = lostResponseMessage('the room list')

  it('says the write may or may not have gone through', () => {
    // Both halves matter. "It failed" is wrong whenever the insert committed
    // and only the response was lost, and the operator's next move — press the
    // button again — is what creates the duplicate.
    expect(message).toMatch(/may or may not have gone through/i)
  })

  it('names the screen that can answer the question', () => {
    expect(message).toContain('the room list')
    expect(lostResponseMessage('the message log')).toContain('the message log')
  })

  it('says what happened and what to do next', () => {
    expect(message).toMatch(/connection/i)
    expect(message).toMatch(/trying again/i)
  })

  it('carries no raw error text, code or jargon', () => {
    // Never `err.message`. Everything below is what a browser or PostgREST
    // actually says, and none of it belongs on a phone in a corridor.
    for (const raw of [
      'Failed to fetch',
      'TypeError',
      'NetworkError',
      'PGRST',
      '23505',
      'null',
      'undefined',
    ]) {
      expect(message).not.toContain(raw)
    }
  })
})

describe('every pending write catches a rejection (M41)', () => {
  for (const site of WRITE_SITES) {
    describe(site.file, () => {
      const src = read(site.file)
      const at = src.indexOf(site.anchor)
      // Everything from the awaited write to the end of the file. The handlers
      // all sit near the end of their component, so a `catch` after the anchor
      // is a `catch` for that await.
      const after = at === -1 ? '' : src.slice(at)

      it('awaits the server action at all', () => {
        expect(at, `${site.file} no longer contains ${site.anchor}`).toBeGreaterThan(-1)
      })

      it('handles the rejection instead of letting it escape', () => {
        expect(after).toContain('catch')
      })

      it('shows the house sentence rather than the raw error', () => {
        expect(after).toContain('lostResponseMessage(')
      })

      it(site.clearInFinally ? 'clears the pending flag in finally' : 'leaves no pending state behind', () => {
        if (site.clearInFinally) {
          expect(after).toContain('finally')
        } else {
          // The phase is moved off 'sending' in both branches, so a stuck
          // spinner is impossible without the phase never changing.
          expect(after).toContain("stage: 'result'")
          expect(after).toContain("stage: 'error'")
        }
      })
    })
  }
})
