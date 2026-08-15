# §4.6 — Unannounced arrivals: scope design

**Status: report only. No implementation yet.**

## The scenario (from the event team)

Extra people arrive with no prior information, at the same time as a scheduled arrival. The
team wants the system to reschedule and assign a car with **at least 2 hours of slack** before
its next pickup.

## Design (mirrors the existing extraction pipeline: PROPOSE only, human commits)

The system never auto-commits — the RSVP extraction pipeline's rule ("AI output is evidence;
a human reviews") is the house pattern, and vehicle allocation already follows it ("Review the
proposal, then commit"). Unannounced arrivals extend the same board.

### 1. Detection

- An unannounced arrival is a guest group whose `travel_legs` has no arrival leg, but the
  group exists (from the calling phase). On the arrivals board, these render as
  "no expected arrival" — the gap the board already surfaces.
- The trigger for this flow is the **"Mark arrived" button on a group with no arrival leg**:
  instead of a flat mark-arrived, the system offers "Add unannounced arrival" → capture the
  actual arrival time + pax (from the phone call or the door).

### 2. Rescheduling logic (PROPOSAL, never commit)

- On adding the unannounced arrival leg, run `pack()` with the new leg added to the day's
  unplaced set.
- **The 2-hour slack rule is a constraint on the proposal, not a wish:** any proposed trip
  carrying the unannounced group must have its next pickup on that vehicle at least 2 hours
  after the unannounced pickup completes. If the only vehicle that fits would violate the
  slack, the proposal flags it as "cannot place within slack" and offers alternatives:
  - a different vehicle (from `vehicle_assignments` / availability),
  - a manual override (human commits anyway — always allowed, and never second-guessed).
- The slack is a configurable constant (`unannouncedSlackMinutes = 120`) beside the other
  `PackOptions`, so the event team can tune it.

### 3. What already exists that this reuses

- `pack.ts` already respects turnaround (`vehicleNextAvailable`) and day boundaries.
- `readAvailableVehicles` + `vehicle_assignments` give the vehicle/driver picture.
- The "proposal → human commits" UI in `LogisticsClient` is the exact interaction model.

### 4. What is NEW (when built)

- A server action to record an unannounced arrival leg (insert into `travel_legs`, source
  `'event_team'`) — the ONLY write in the flow.
- A proposal variant that adds the slack constraint and explains placement failures.
- UI: on the arrivals board, "unannounced" badge + tap-to-propose.

### 5. Open question for the event team

- **Is 2 hours the minimum gap between the unannounced pickup and the NEXT pickup, or between
  the unannounced drop-off and the next pickup?** The runbook says "at least 2 hours of slack
  before its next pickup." If it's from pickup, the slack is easier (just a time gap); if from
  drop-off, it depends on route time. Recommend: **from pickup**, matching the pack engine's
  turnaround model, and confirm with the team.

## DoD when built

- Proposal mode: unannounced group appears in the proposal; committed trip carries it.
- Slack rule enforced at proposal time; a violating placement is flagged, never silent.
- Human override always available; nothing auto-commits.
