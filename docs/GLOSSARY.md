# EventFlow Plain Language Glossary

This glossary defines the authoritative user-facing vocabulary for EventFlow. Every noun and status shown to an end user must use the plain terms listed below.

Trade terms and engineering jargon are banned from UI copy; they may remain only in database identifiers, TypeScript code, and specific Excel export headers where legacy client spreadsheets require them.

| Term in code | What to show a user | Where the code word may stay | Real file(s) where term appears |
|---|---|---|---|
| `pax` / `PAX` | "guests" (or "number of guests") | Keep "PAX" ONLY as an Excel column header in `src/lib/export/sheets.ts` for spreadsheet parity. Internal variables, DB columns (`expected_pax`, `confirmed_pax`). | `src/app/(staff)/[eventCode]/dashboard/page.tsx`<br>`src/app/(staff)/[eventCode]/guests/list/_components/GuestCard.tsx`<br>`src/app/(staff)/[eventCode]/rsvp/review/[extractionId]/page.tsx`<br>`src/app/(staff)/[eventCode]/logistics/departures/DeparturesClient.tsx` |
| `group` / `guest_group` | "family" | Database tables `guest_groups`, column `group_id`, functions in `src/lib/actions/rsvp.ts`. | `src/app/(staff)/[eventCode]/dashboard/page.tsx`<br>`src/app/(staff)/[eventCode]/guests/list/GuestsClient.tsx`<br>`src/lib/actions/rsvp.ts` |
| `deliverable` | "hamper" or "return gift" (use the specific item, never umbrella term) | Tables `deliverables`, `delivery_proofs`, API functions in `src/lib/actions/deliveries.ts`. | `src/app/(staff)/[eventCode]/hospitality/deliveries/page.tsx`<br>`src/app/(staff)/[eventCode]/hospitality/deliveries/DeliveriesClient.tsx`<br>`src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx` |
| `extraction` | "call notes" | Table `rsvp_extractions`, RPC `apply_rsvp_extraction`, internal processing in `src/lib/extraction/`. | `src/app/(staff)/[eventCode]/rsvp/review/page.tsx`<br>`src/app/(staff)/[eventCode]/rsvp/review/[extractionId]/page.tsx`<br>`src/app/(staff)/[eventCode]/rsvp/review/[extractionId]/loading.tsx` |
| `unmatched` | "unknown numbers" | Status enums, IndexedDB ledger status in `src/lib/harvest-ledger.ts` (`status: 'unmatched'`), route segments. | `src/lib/sections/config.tsx`<br>`src/app/(staff)/[eventCode]/rsvp/unmatched/page.tsx`<br>`src/app/(staff)/[eventCode]/rsvp/unmatched/UnmatchedTrayClient.tsx` |
| `harvest` | "imported recordings" | Native plugin wrappers (`CallRecordingHarvestPlugin`), `src/lib/harvest.ts`, `src/lib/harvest-ledger.ts`. | `src/app/(admin)/AdminSidebar.tsx`<br>`src/app/(admin)/admin/harvest-debug/HarvestDebugClient.tsx`<br>`src/lib/harvest.ts` |
| `travel leg` | "arrival" or "departure" | Table `travel_legs`, view `v_travel_ledger`, TypeScript database types. | `src/app/(staff)/[eventCode]/guests/list/_components/format.ts`<br>`src/app/(staff)/[eventCode]/guests/_components/format.ts`<br>`src/app/(staff)/[eventCode]/dashboard/page.tsx` |
| `roomed` | "has a room" | View columns `guests_roomed`, TS query return values in `dashboard.ts`. | `src/app/(staff)/[eventCode]/dashboard/page.tsx`<br>`src/app/(staff)/[eventCode]/guests/list/_components/ClientGuestList.tsx` |
| `Board` (tab label) | "Home" | Internal section id `'dashboard'`, function names `readBoard()`. | `src/lib/sections/config.tsx`<br>`src/app/(staff)/[eventCode]/dashboard/page.tsx` |
| `Stay` (tab label) | "Rooms" | Internal child segment `rooms`, section `hospitality`. | `src/lib/sections/config.tsx`<br>`src/components/nav/BottomTabs.tsx` |
| `Prep` (tab label) | "Setup" | Internal feature flag `production`, section `production`. | `src/lib/sections/config.tsx` |
| `access code` | "your code" | Table `access_codes`, cookie name `nuvent_code_auth` (frozen per CLAUDE.md §12). | `src/app/(auth)/login/page.tsx`<br>`src/app/(auth)/login/CodeLoginForm.tsx` |
| `event_team` / `client` | "team" / "family view" | Database enum `app_role`, JWT claims, server guard parameters. | `src/lib/sections/config.tsx`<br>`src/app/(staff)/[eventCode]/layout.tsx`<br>`CLAUDE.md` §7 |
| `ledger` | "travel overview" | View `v_travel_ledger`, CSS easing `ease-ledger`, admin route segments. | `src/app/(admin)/admin/events/[eventCode]/ledger/LedgerClient.tsx`<br>`src/components/ui/EmptyState.tsx` |
| `fleet` | "Vehicles" | Table `vehicles`, internal route `/logistics/fleet`. | `src/lib/sections/config.tsx`<br>`src/app/(staff)/[eventCode]/logistics/fleet/FleetClient.tsx` |
| `checkin` / `checkout` | "Check-in / out" | Child segment `checkin`, internal timestamp columns in `room_assignments`. | `src/lib/sections/config.tsx`<br>`src/app/(staff)/[eventCode]/dashboard/page.tsx` |
