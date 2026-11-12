import { describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'

vi.mock('server-only', () => ({}))

const { TEST_SECRET } = vi.hoisted(() => {
  const secret = 'test-jwt-secret-key-at-least-32-bytes-long!'
  process.env.JWT_SECRET = secret
  return { TEST_SECRET: secret }
})

import { verifyCodeAuthToken } from '@/lib/auth/claims'

const SECRET_BYTES = new TextEncoder().encode(TEST_SECRET)

async function makeToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET_BYTES)
}

describe('verifyCodeAuthToken — department claim verification', () => {
  const basePayload = {
    app_role: 'team',
    event_id: 'b817e2b0-973b-4f8e-b495-dd9bc2afbd28',
    access_code_id: '11111111-2222-3333-4444-555555555555',
    staff_member_id: 'staff-123',
  }

  it('verifies a token with department "rsvp" to department "rsvp"', async () => {
    const token = await makeToken({
      ...basePayload,
      department: 'rsvp',
    })

    const claims = await verifyCodeAuthToken(token)
    expect(claims).not.toBeNull()
    expect(claims?.department).toBe('rsvp')
    expect(claims?.appRole).toBe('team')
    expect(claims?.eventId).toBe(basePayload.event_id)
    expect(claims?.accessCodeId).toBe(basePayload.access_code_id)
    expect(claims?.staffMemberId).toBe('staff-123')
  })

  it('sets department to null when an unknown department is provided', async () => {
    const token = await makeToken({
      ...basePayload,
      department: 'catering',
    })

    const claims = await verifyCodeAuthToken(token)
    expect(claims).not.toBeNull()
    expect(claims?.department).toBeNull()
    expect(claims?.appRole).toBe('team')
    expect(claims?.eventId).toBe(basePayload.event_id)
    expect(claims?.accessCodeId).toBe(basePayload.access_code_id)
  })

  it('sets department to null when department is omitted or not a string', async () => {
    const tokenMissing = await makeToken(basePayload)
    const claimsMissing = await verifyCodeAuthToken(tokenMissing)
    expect(claimsMissing).not.toBeNull()
    expect(claimsMissing?.department).toBeNull()

    const tokenNumber = await makeToken({ ...basePayload, department: 12345 })
    const claimsNumber = await verifyCodeAuthToken(tokenNumber)
    expect(claimsNumber).not.toBeNull()
    expect(claimsNumber?.department).toBeNull()
  })

  it('verifies other supported departments properly', async () => {
    const knownDepts = ['management', 'logistics', 'hospitality', 'hamper', 'production'] as const
    for (const dept of knownDepts) {
      const token = await makeToken({ ...basePayload, department: dept })
      const claims = await verifyCodeAuthToken(token)
      expect(claims?.department).toBe(dept)
    }
  })

  it('returns null if token signature does not match', async () => {
    const otherSecret = new TextEncoder().encode('different-secret-key-different-bytes!!')
    const token = await new SignJWT({ ...basePayload, department: 'rsvp' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(otherSecret)

    const claims = await verifyCodeAuthToken(token)
    expect(claims).toBeNull()
  })
})
