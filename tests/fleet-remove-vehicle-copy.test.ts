import { describe, expect, it } from 'vitest'

import {
  availabilityActionLabel,
  removeVehicleQuestion,
  vehicleDisplayName,
} from '../src/lib/fleet/remove-vehicle-copy'

describe('remove-vehicle confirmation copy', () => {
  it('names the vehicle AND its registration number', () => {
    const question = removeVehicleQuestion({ label: 'Tempo Traveller', registrationNo: 'GJ 05 AB 1234' })
    expect(question).toContain('Tempo Traveller')
    expect(question).toContain('GJ 05 AB 1234')
  })

  it('still names the vehicle when only one identifier exists', () => {
    expect(removeVehicleQuestion({ label: 'Innova', registrationNo: null })).toContain('Innova')
    expect(removeVehicleQuestion({ label: null, registrationNo: 'GJ 05 AB 1234' })).toContain(
      'GJ 05 AB 1234',
    )
    expect(vehicleDisplayName({ label: null, registrationNo: null })).toBe('this vehicle')
  })
})

describe('availabilityActionLabel', () => {
  it('offers the reversible move that fits the current status', () => {
    expect(availabilityActionLabel('available')).toBe('Mark unavailable')
    expect(availabilityActionLabel('assigned')).toBe('Mark unavailable')
    expect(availabilityActionLabel('unavailable')).toBe('Mark available')
  })
})
