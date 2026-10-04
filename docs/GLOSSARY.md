# EventFlow Plain Language Glossary

> **Superseded for wording by `docs/COPY-INDIA.md`.** That file is the authority
> for every string a person reads. **Staff screens use PAX.** Where the two
> disagree, `docs/COPY-INDIA.md` wins.

This glossary defines the user-facing vocabulary for EventFlow. Every noun and
status shown to an end user must use the terms listed below.

Trade terms and engineering jargon are banned from UI copy; they may remain only
in database identifiers, TypeScript code, and specific Excel export headers where
legacy client spreadsheets require them.

| Term in code | What to show a user | Where the code word may stay | Real file(s) where term appears |
|---|---|---|---|
| `pax` / `PAX` | "PAX" on staff screens; "guests" on the client (family) view | Excel column headers and DB columns (`expected_pax`, `confirmed_pax`). | `src/lib/export/sheets.ts`<br>`src/lib/sections/config.tsx` |
| `adults` / `children` | "adults" / "children" | Columns `guest_groups.expected_adults`/`expected_children` (invited split) and `adults_confirmed`/`children_confirmed` (split recorded on the call). Guests = everyone; a child is under 12. | `supabase/migrations/20261003090000_guest_groups_expected_split.sql`<br>`src/lib/export/definitions.ts` |
| `group` / `guest_group` | "Family" | Tables `guest_groups`, column `group_id`, functions in `src/lib/actions/rsvp.ts`. | `src/lib/actions/rsvp.ts` |
| `deliverable` | "Hamper" or "Return gift" (the specific item, never the umbrella term) | Tables `deliverables`, `delivery_proofs`, API functions in `src/lib/actions/deliveries.ts`. | `src/lib/actions/deliveries.ts` |
| `extraction` | "Call Records" | Table `rsvp_extractions`, RPC `apply_rsvp_extraction`, processing in `src/lib/extraction/`. | `src/lib/extraction/` |
| `unmatched` | "Unknown Numbers" | Status enums, IndexedDB ledger status in `src/lib/harvest-ledger.ts` (`status: 'unmatched'`), route segments. | `src/lib/sections/config.tsx` |
| `harvest` | "imported recordings" | Native plugin wrappers (`CallRecordingHarvestPlugin`), `src/lib/harvest.ts`, `src/lib/harvest-ledger.ts`. | `src/lib/harvest.ts` |
| `travel leg` | "Pickup & Drop" | Table `travel_legs`, view `v_travel_ledger`, TypeScript database types. | `src/lib/sections/config.tsx` |
| `roomed` | "Rooms allotted" | View columns `guests_roomed`, TS query return values in `dashboard.ts`. | `src/lib/actions/dashboard.ts` |
| `Board` (menu label) | "Dashboard" (the Home screen's own title is "Today's Status") | Internal section id `'dashboard'`, function names `readBoard()`. | `src/lib/sections/config.tsx` |
| `rsvp` (section name) | "RSVP" | Internal section id `rsvp`, route segment `/rsvp`, table `call_attempts`, filter/queue modules. Named "Calls" in the UI until 3 Oct 2026. | `src/lib/sections/v3.ts`<br>`src/lib/sections/config.tsx` |
| `Stay` (tab label) | "Room Allotment" | Internal child segment `rooms`, section `hospitality`. | `src/lib/sections/config.tsx` |
| `Prep` (tab label) | "Hotel & Room Setup" | Internal feature flag `production`, section `production`. | `src/lib/sections/config.tsx` |
| `access code` | "Login code" | Table `access_codes`, cookie name `nuvent_code_auth` (frozen per CLAUDE.md §12). | `src/app/(auth)/login/CodeLoginForm.tsx` |
| `event_team` / `client` | "team" / "family view" | Database enum `app_role`, JWT claims, server guard parameters. | `src/lib/sections/config.tsx`<br>CLAUDE.md §7 |
| `ledger` | "travel overview" | View `v_travel_ledger`, CSS easing `ease-ledger`, admin route segments. | `src/lib/sections/config.tsx` |
| `fleet` | "Vehicles" | Table `vehicles`, internal route `/logistics/fleet`. | `src/lib/sections/config.tsx` |
| `checkin` / `checkout` | "Check-in / Check-out" | Child segment `checkin`, internal timestamp columns in `room_assignments`. | `src/lib/sections/config.tsx` |
