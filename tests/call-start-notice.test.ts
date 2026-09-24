import { describe, expect, it } from 'vitest'

import { callStartNotice } from '../src/lib/outbound/call-notice'

describe('callStartNotice', () => {
  it('keeps a real message from the dialer instead of guessing', () => {
    // The bug: `body.message ?? body.started ? … : …` discarded this string
    // and answered "Call started" for a job that was only queued.
    expect(callStartNotice({ message: 'Queued — will dial when a line frees up', started: false })).toBe(
      'Queued — will dial when a line frees up',
    )
  })

  it('prefers the dialer message even when a call did start', () => {
    expect(callStartNotice({ message: 'Ringing Ravi Kumar', started: true })).toBe('Ringing Ravi Kumar')
  })

  it('says a call started only when the dialer says it did', () => {
    expect(callStartNotice({ started: true })).toBe('Call started')
  })

  it('says the job is queued when it never dialled', () => {
    expect(callStartNotice({ started: false })).toBe('Job queued')
    expect(callStartNotice({})).toBe('Job queued')
  })

  it('treats a blank message as no message', () => {
    expect(callStartNotice({ message: '   ', started: true })).toBe('Call started')
    expect(callStartNotice({ message: '', started: false })).toBe('Job queued')
  })

  it('never returns a non-string message', () => {
    expect(callStartNotice({ message: { text: 'hi' }, started: true })).toBe('Call started')
  })
})
