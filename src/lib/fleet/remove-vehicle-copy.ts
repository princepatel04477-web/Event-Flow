/**
 * The words for taking a vehicle off the fleet — the reversible action, and
 * the irreversible one behind it.
 *
 * `delete from vehicles` is a hard delete: the row goes, and with it the
 * odometer readings, driver pairings and trip history. The old control read
 * "Remove from the fleet", which sounds like detaching, and it ran on one tap.
 * These sentences are the correction, and they live here so a test can pin
 * that the registration number is actually named.
 */
export interface VehicleIdentity {
  label: string | null
  registrationNo: string | null
}

/** "Tempo Traveller (GJ 05 AB 1234)", or whatever part exists. */
export function vehicleDisplayName(vehicle: VehicleIdentity): string {
  const label = vehicle.label?.trim()
  const registration = vehicle.registrationNo?.trim()
  if (label && registration) return `${label} (${registration})`
  return label || registration || 'this vehicle'
}

/** The confirmation heading. Names the vehicle, registration included. */
export function removeVehicleQuestion(vehicle: VehicleIdentity): string {
  return `Remove ${vehicleDisplayName(vehicle)} for good?`
}

/** What the hard delete takes with it. Never a shrug, never an error code. */
export function removeVehicleConsequence(): string {
  return (
    'This cannot be undone. Deleting the vehicle also deletes its odometer readings, ' +
    'driver pairings and trip history.'
  )
}

/** The reversible action's label, which flips with the current status. */
export function availabilityActionLabel(status: string): string {
  return status === 'unavailable' ? 'Mark available' : 'Mark unavailable'
}

export default removeVehicleQuestion
