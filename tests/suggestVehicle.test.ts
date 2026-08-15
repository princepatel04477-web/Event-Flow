/**
 * R3 — vehicle suggestion by PAX — `src/lib/logistics/suggestVehicle.ts`.
 *
 * The invariants under test mirror the pack engine's hard rules:
 * a vehicle whose luggage-adjusted capacity is below the group's PAX is
 * never suggested, and the smallest-vehicle-that-fits wins (a sedan before
 * a bus — the bus is needed for a bigger group later).
 */

import { describe, expect, it } from 'vitest'

import {
  suggestVehiclesForPax,
  type VehicleSuggestionInput,
} from '@/lib/logistics/suggestVehicle'

function v(partial: Partial<VehicleSuggestionInput> & { id: string }): VehicleSuggestionInput {
  return { label: null, capacity: 4, ...partial }
}

describe('suggestVehiclesForPax — hard constraint', () => {
  it('never suggests a vehicle whose capacity is below the PAX', () => {
    const result = suggestVehiclesForPax(6, [
      v({ id: 'sedan', label: 'Sedan', capacity: 3 }),
      v({ id: 'suv', label: 'SUV', capacity: 4 }),
    ])
    expect(result.suggestions).toHaveLength(0)
    expect(result.tooLarge).toBe(true)
    expect(result.tooLargeReason).toContain('No single vehicle')
  })

  it('suggests a vehicle that exactly fits', () => {
    const result = suggestVehiclesForPax(6, [
      v({ id: 'tt', label: 'Tempo Traveller', capacity: 6 }),
      v({ id: 'bus', label: 'Bus', capacity: 44 }),
    ])
    expect(result.suggestions).toHaveLength(2)
    expect(result.suggestions[0].vehicleId).toBe('tt')
    expect(result.suggestions[0].reason).toContain('exactly')
  })
})

describe('suggestVehiclesForPax — smallest first', () => {
  it('prefers the smallest vehicle that fits (no bus for a family of 3)', () => {
    const result = suggestVehiclesForPax(3, [
      v({ id: 'bus', label: 'Bus', capacity: 44 }),
      v({ id: 'sedan', label: 'Sedan', capacity: 3 }),
      v({ id: 'suv', label: 'SUV', capacity: 4 }),
    ])
    expect(result.suggestions[0].vehicleId).toBe('sedan')
    expect(result.suggestions[1].vehicleId).toBe('suv')
  })

  it('returns up to 3 suggestions', () => {
    const result = suggestVehiclesForPax(2, [
      v({ id: 'a', label: 'A', capacity: 2 }),
      v({ id: 'b', label: 'B', capacity: 4 }),
      v({ id: 'c', label: 'C', capacity: 6 }),
      v({ id: 'd', label: 'D', capacity: 8 }),
    ])
    expect(result.suggestions).toHaveLength(3)
  })

  it('sorts by capacity then label for determinism', () => {
    const result = suggestVehiclesForPax(2, [
      v({ id: 'y', label: 'Y', capacity: 4 }),
      v({ id: 'x', label: 'X', capacity: 4 }),
      v({ id: 'z', label: 'Z', capacity: 2 }),
    ])
    expect(result.suggestions.map((s) => s.vehicleId)).toEqual(['z', 'x', 'y'])
  })
})

describe('suggestVehiclesForPax — reasons + spare seats', () => {
  it('gives every suggestion a human-readable reason with the spare count', () => {
    const result = suggestVehiclesForPax(3, [v({ id: 'suv', label: 'SUV', capacity: 4 })])
    expect(result.suggestions[0].reason).toContain('SUV')
    expect(result.suggestions[0].reason).toContain('1 seat spare')
    expect(result.suggestions[0].spareSeats).toBe(1)
  })

  it('handles a zero or negative PAX as empty, not an error', () => {
    expect(suggestVehiclesForPax(0, [v({ id: 'a', capacity: 4 })]).suggestions).toHaveLength(0)
    expect(suggestVehiclesForPax(-1, [v({ id: 'a', capacity: 4 })]).suggestions).toHaveLength(0)
  })

  it('uses luggage-adjusted capacity, not seat labels', () => {
    // A 17-seat Tempo carries 12 with luggage. The engine must see 12.
    const result = suggestVehiclesForPax(12, [
      v({ id: 'tt', label: 'Tempo (17 seats)', capacity: 12 }),
      v({ id: 'sedan', label: 'Sedan', capacity: 3 }),
    ])
    expect(result.suggestions[0].vehicleId).toBe('tt')
  })
})
