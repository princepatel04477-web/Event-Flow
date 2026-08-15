/**
 * R3 — vehicle suggestion by arriving PAX (§4.2).
 *
 * The event team's most-repeated ask: "what car do we send for these people?"
 * The pack engine (pack.ts) already fits families into vehicles greedily when
 * planning a full day. This is the SMALLER, per-arrival question: a group of
 * N people lands at a time slot, which vehicles could take them?
 *
 * Rules, matching the SRS and the pack engine's hard constraints:
 *   - A vehicle is NEVER suggested if its luggage-adjusted capacity < PAX.
 *     Capacity is the luggage-adjusted figure from vehicles.capacity — never
 *     the sticker seat count.
 *   - Suggests the smallest vehicles that fit first (a sedan before a bus),
 *     then larger options, up to 3 — the human picks.
 *   - Availability is a separate concern (vehicle_assignments / committed
 *     trips); this function answers capacity only. The caller filters.
 *   - The system PROPOSES. Nothing here writes. A human commits, exactly as
 *     the RSVP extraction pipeline and room allocation do.
 *
 * Pure: no DOM, no Supabase, no clock. Same inputs, same output.
 */

export interface VehicleSuggestionInput {
  id: string
  label: string | null
  /** Luggage-adjusted capacity. The ONLY number used. */
  capacity: number
}

export interface VehicleSuggestion {
  vehicleId: string
  vehicleLabel: string | null
  capacity: number
  /** e.g. "Sedan fits 3 of 4 people — no wasted seats." */
  reason: string
  /** How much capacity is left over after this group boards. */
  spareSeats: number
}

export interface VehicleSuggestionResult {
  suggestions: VehicleSuggestion[]
  /** True when no vehicle in the pool can take this many people. */
  tooLarge: boolean
  tooLargeReason: string | null
}

const MAX_SUGGESTIONS = 3

/**
 * Suggest up to 3 vehicles for an arriving group of `pax`.
 *
 * Hard constraint: capacity < pax is never suggested. Soft preference:
 * smallest-that-fits first (a 3-seat sedan for a 3-person family beats an
 * empty 50-seat bus — the bus is needed for a 40-person group later).
 */
export function suggestVehiclesForPax(
  pax: number,
  vehicles: VehicleSuggestionInput[],
): VehicleSuggestionResult {
  if (pax <= 0) {
    return { suggestions: [], tooLarge: false, tooLargeReason: null }
  }

  const fitting = vehicles
    .filter((v) => v.capacity >= pax)
    .sort((a, b) => a.capacity - b.capacity || (a.label ?? '').localeCompare(b.label ?? ''))

  if (fitting.length === 0) {
    return {
      suggestions: [],
      tooLarge: true,
      tooLargeReason:
        `No single vehicle can take ${pax} people with luggage. ` +
        'Split the group across vehicles by hand — a family is never split automatically.',
    }
  }

  const suggestions: VehicleSuggestion[] = fitting.slice(0, MAX_SUGGESTIONS).map((v) => {
    const spare = v.capacity - pax
    const reason =
      spare === 0
        ? `${v.label ?? 'Vehicle'} fits ${pax} exactly — no wasted seats.`
        : `${v.label ?? 'Vehicle'} fits ${pax} of ${v.capacity} with ${spare} ${spare === 1 ? 'seat' : 'seats'} spare.`
    return {
      vehicleId: v.id,
      vehicleLabel: v.label,
      capacity: v.capacity,
      reason,
      spareSeats: spare,
    }
  })

  return { suggestions, tooLarge: false, tooLargeReason: null }
}
