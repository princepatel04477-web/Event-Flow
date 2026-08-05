# Software Requirements Specification
## Event Ops — Wedding Event Operations Platform

| | |
|---|---|
| **Document version** | 1.0 |
| **Date** | 1 August 2026 |
| **Author** | Prince |
| **Status** | Baselined for Phase 1 development |
| **Supersedes** | `SRS` (raw requirements notes, 19 sections) |
| **Submission deadline** | 26 August 2026 |

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Overall description](#2-overall-description)
3. [Users, roles and access control](#3-users-roles-and-access-control)
4. [System architecture](#4-system-architecture)
5. [Data model](#5-data-model)
6. [Functional requirements](#6-functional-requirements)
7. [External interfaces](#7-external-interfaces)
8. [Non-functional requirements](#8-non-functional-requirements)
9. [Integrity guarantees](#9-integrity-guarantees)
10. [Delivery phases](#10-delivery-phases)
11. [Acceptance criteria](#11-acceptance-criteria)
12. [Open decisions and risks](#12-open-decisions-and-risks)
13. [Traceability to source notes](#13-traceability-to-source-notes)

---

## 1. Introduction

### 1.1 Purpose

This document specifies the requirements for **Event Ops**, a centralised event operations platform for large Indian weddings. It replaces a fragmented set of manual workflows — Excel sheets, Google Forms, paper calling registers, ad-hoc room charts, WhatsApp threads — with a single system in which the event team and the client can track every guest from first RSVP call through to departure and return gift.

This SRS is the contract between the requirement notes and the code. Where the two disagree, this document wins.

### 1.2 Scope

**In scope**

- Guest and family-group registration, with RSVP status and PAX tracking
- RSVP calling workflow, including call logging, voice capture, transcription and assisted data extraction with human review
- Room allocation across one or more hotels
- Arrival and departure logistics, vehicle allocation and trip management
- Hamper and return-gift distribution with tamper-evident photographic proof
- WhatsApp templated messaging
- Client-facing dashboard and read-only guest road view
- Excel import and export in both directions
- Reports and operational analytics

**Out of scope for v1**

- Payments, invoicing or vendor management
- Seating charts, menu planning, catering counts
- Public Play Store distribution (APK is side-loaded)
- Cloud telephony / number masking (noted as a possible later addition)
- Any guest-facing self-service portal

### 1.3 Definitions

| Term | Meaning |
|---|---|
| **Event** | One wedding. The tenancy boundary. Every row in the system belongs to exactly one event. |
| **Guest group** | The calling and hospitality unit — typically one family, headed by a family head. Also covers couples, friend clusters and single persons. |
| **Family head** | The named person representing a guest group; the contact for calls, rooms, hampers and logistics. |
| **PAX** | Number of persons in a group, as opposed to the number of individually named guest records. |
| **Expected PAX** | PAX carried over from the source Excel before RSVP. |
| **Confirmed PAX** | PAX confirmed by the guest during an RSVP call. Authoritative for rooms, vehicles and hampers. |
| **Deliverable** | A hamper or a return gift. One table, distinguished by a `kind` enum. |
| **Delivery proof** | A staff-captured photograph of a handoff, with a server-assigned timestamp. |
| **Travel leg** | One arrival or one departure movement for a group. |
| **Side** | Bride or Groom. |

### 1.4 References

- `CALLING_MASTER_LIST.xlsx` — source data, Sheet1, 238 family groups / 465 guests
- `SRS` — original 19-section requirement notes
- `CLAUDE.md` — repository context file for the coding agent

---

## 2. Overall description

### 2.1 Product perspective

Event Ops is a **multi-tenant** platform. Although it is being built for one specific wedding, tenancy is designed in from the first migration so the same deployment can host future events without a rewrite. Every table carries `event_id`; row-level security is scoped to it.

The system is **mobile-first**. The primary users are 10–20 event staff working on inexpensive Android phones at hotels, airports and venue gates — frequently on weak or absent networks.

The system is **offline-tolerant, not offline-first**: reads are served from cache and writes are queued locally, but Postgres is always the source of truth.

### 2.2 Scale

| Dimension | Figure |
|---|---|
| Guest groups | ~238 |
| Named guests | ~465 |
| Concurrent staff devices | 10–20 |
| Hotels | 1–5 |
| Expected total rows across all tables | Low tens of thousands |

This is a *many-tables, low-volume* workload. Data volume is not a performance concern; correctness under concurrency and connectivity loss is.

### 2.3 Operating environment

| | |
|---|---|
| Staff devices | Android 10+, Chrome / installed PWA / side-loaded APK |
| Client & admin | Desktop and mobile browsers |
| Network | Hotel Wi-Fi and 4G, both unreliable at the venue |
| Languages spoken on calls | Gujarati, Hindi, English — frequently code-switched mid-sentence |
| Region | Supabase Mumbai (`ap-south-1`) for latency |

### 2.4 Assumptions and dependencies

- The final guest list arrives as Excel and will change repeatedly until close to the event. Excel import must therefore be re-runnable, not one-shot.
- WhatsApp Business API access via an Indian BSP requires business verification and template approval; the timeline for this is outside the team's control and is the single largest schedule risk.
- Automatic call recording is restricted on some Android 13+ handsets. Where the OS blocks it, no application-side fix exists; the system must degrade to a post-call voice note captured inside the app.
- Staff will be trained but are not technical. Screens must be usable without instruction.

### 2.5 Constraints

| ID | Constraint |
|---|---|
| CON-01 | Hard submission deadline of 26 August 2026 |
| CON-02 | Single developer, working with a coding agent |
| CON-03 | No Play Store submission — APK distributed over WhatsApp |
| CON-04 | Stack is locked (§4.1) and shall not be re-litigated mid-build |
| CON-05 | Feature freeze at the start of the final week; only bug fixes thereafter |

---

## 3. Users, roles and access control

### 3.1 Role definitions

| Role | Who | Scope |
|---|---|---|
| **admin** | Prince (builder) and his partner (event handler) | Every event |
| **event_team** | On-ground staff — callers, desk, hamper, logistics | One event |
| **client** | The wedding family whose event it is | One event, read-only |

There is no fourth role. There is no global "see everything" switch other than `profiles.global_role = 'admin'`.

### 3.2 Access matrix

| | admin | event_team | client |
|---|---|---|---|
| Scope | all events | one event | one event |
| Base tables | read / write / delete | read / insert / update | **none** |
| Views | all | staff views | `client_guest_profiles` only |
| Can see other events exist | yes | no | no |
| Can change roles | yes | no | no |
| Can delete records | yes, except delivery proofs | no | no |
| Can resolve hamper disputes | yes | no | no |

**AC-01** — A `client` login querying a base table shall receive **zero rows**, not a permission error. The client must not be able to infer that other events exist in the same database.

**AC-02** — Access is granted per event through `event_members`, never by application-layer checks alone.

**AC-03** — Every role restriction in this section shall be enforced by Postgres row-level security. Application-layer checks are a usability convenience only and are not the control.

---

## 4. System architecture

### 4.1 Technology stack (locked)

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript | Single codebase for web and, via wrapper, mobile |
| Styling | Tailwind CSS + shadcn/ui | Speed under deadline |
| Backend | Supabase — Postgres 16, Auth, Storage, Edge Functions, Realtime | One service, no glue code; recordings and photos sit beside the data |
| Data layer | TanStack Query + Dexie (IndexedDB) | Cache-and-queue offline behaviour |
| Tables | TanStack Table | Large guest grids |
| Forms | react-hook-form + Zod | Validation shared client and server |
| Excel | SheetJS | Import and export only |
| Charts | Recharts | Dashboard |
| Mobile | PWA first, then **Capacitor** APK | Wraps the existing web app; nothing new to learn under deadline. Not Expo, not React Native. |
| Hosting | Vercel | |
| Monitoring | Sentry | |
| Speech-to-text | Sarvam Saarika or Google STT v2 (`gu-IN`, `hi-IN`, `en-IN`) | Behind an interface; provider decided after testing on real recordings |
| Extraction | Claude → strict JSON with per-field confidence | |
| WhatsApp | Meta Cloud API via an Indian BSP (AiSensy / Interakt / Gupshup) | BSP absorbs verification and template overhead |

### 4.2 Architectural principles

1. **Postgres is the truth. Excel is an interface.** Import and export are conveniences; no workflow may depend on a spreadsheet being current.
2. **Integrity lives in the database, not the application.** Tenancy, insert-only proofs, server clocks, capacity limits and double-booking prevention are all constraints and triggers. A buggy client cannot violate them.
3. **Machine output is evidence; only reviewed commits are data.** Transcripts and extractions never write to guest records directly.
4. **Resume-first, not continue-first.** Any flow interrupted by the OS (dialling, camera, backgrounding) must be recoverable from persisted state.

### 4.3 RSVP capture pipeline

```text
tel: dial
   ↓
call recording (native module) OR post-call voice note (MediaRecorder, opus)
   ↓
IndexedDB queue  →  Supabase Storage (private bucket)
   ↓
Edge function: STT          (gu-IN + hi-IN + en-IN)
   ↓
Edge function: Claude       → strict JSON + per-field confidence
   ↓
REVIEW SCREEN               ← human confirms every field
   ↓
apply_rsvp_extraction()     → commit to guest_groups / travel_legs
   ↓
Excel export
```

Neither edge function may write to `guest_groups` or `travel_legs`. That boundary is the whole integrity story.

---

## 5. Data model

### 5.1 Table map

**Tenancy**
`events` · `profiles` · `event_members` · `audit_log`

**Guests and RSVP**
`guest_groups` — one row per family head; carries `expected_pax`, `confirmed_pax`, `rsvp_status`, `side`, `group_type`, `needs_return_gift`, and the caller lock (`locked_by`, `locked_until`)
`guests` — individually named members, linked to a group
`travel_legs` — arrival **and** departure in one table, so an arrival/departure reconciliation is a single query
`call_attempts` → `call_recordings` → `transcripts` → `rsvp_extractions`

**Rooms**
`hotels` · `rooms` · `room_assignments`

**Hampers and return gifts**
`deliverables` (with `kind` enum: `hamper` | `return_gift`) · `delivery_proofs`

**Logistics**
`vehicle_types` · `vehicles` · `trips` · `trip_passengers`

**Messaging and import**
`message_templates` · `messages` · `import_batches` · `import_rows`

**Views**
`client_guest_profiles` · `v_rsvp_queue` · `v_travel_ledger` · `v_event_dashboard`

**RPCs**
`claim_group()` · `release_group()` · `apply_rsvp_extraction()`

### 5.2 Consolidated guest group record

| Field | Notes |
|---|---|
| Group ID | UUID, primary key |
| Event ID | Tenancy key, on every row |
| Family number | From the source Excel "U" column, unique within event |
| Head name | |
| Surname | |
| Mobile | Normalised: `+91` stripped, last 10 digits stored |
| Place / city | |
| Group type | family / couple / friends / single |
| Side | bride / groom |
| Expected PAX | From Excel |
| Confirmed PAX | From RSVP; authoritative downstream |
| RSVP status | confirmed / declined / tentative / callback / unreachable |
| Remarks | |
| Locked by / locked until | Caller concurrency lock |

Arrival and departure live in `travel_legs`; room, vehicle, hamper and return-gift status are derived from their own tables rather than denormalised onto the group.

### 5.3 Tenancy enforcement

Child tables use **composite foreign keys** `(child_id, event_id)` referencing `(id, event_id)` on the parent. A row therefore *cannot physically* point at a parent in a different event, independent of any RLS policy.

---

## 6. Functional requirements

### 6.1 Guest and group management

| ID | Requirement | Priority |
|---|---|---|
| FR-GRP-01 | The system shall store guest groups with head, surname, mobile, place, type, side, expected PAX and remarks. | Must |
| FR-GRP-02 | The system shall store individually named guests linked to a group. | Must |
| FR-GRP-03 | Excel import shall create a `guests` row for the family head, not only a `guest_groups` row. | Must |
| FR-GRP-04 | The system shall support search across guest name, family head, surname, mobile and room number, returning results in under one second on 465 records. | Must |
| FR-GRP-05 | The system shall classify each group as bride-side or groom-side, and shall support filtering and counting by side. | Must |
| FR-GRP-06 | Group type (family / couple / friends / single) shall be recorded and filterable. | Should |

### 6.2 RSVP and calling

| ID | Requirement | Priority |
|---|---|---|
| FR-RSVP-01 | The system shall present a prioritised calling queue of groups requiring RSVP contact. | Must |
| FR-RSVP-02 | A caller shall be able to claim a group via `claim_group()`, taking an exclusive lock. Two devices shall never hold the same group simultaneously. | Must |
| FR-RSVP-03 | Locks shall expire automatically so an abandoned call does not strand a group. | Must |
| FR-RSVP-04 | The system shall initiate calls via `tel:` deep links. The system shall **not** implement its own dialer. | Must |
| FR-RSVP-05 | A `call_attempts` row shall be written with `started_at` **before** the dial fires, its id held in `sessionStorage`, and rehydrated when the app resumes. | Must |
| FR-RSVP-06 | The system shall record call outcome, duration and per-group call count. | Must |
| FR-RSVP-07 | The system shall capture call audio — via the native recording module where the OS permits, otherwise via an in-app post-call voice note. | Must |
| FR-RSVP-08 | Audio shall be queued in IndexedDB and uploaded to a private Supabase Storage bucket when connectivity returns. A 60-second note shall survive app backgrounding. | Must |
| FR-RSVP-09 | An edge function shall transcribe audio with language hints `gu-IN`, `hi-IN`, `en-IN`, retry twice with backoff on failure, then mark the transcript failed and surface it in the UI. Failures shall never be silent. | Must |
| FR-RSVP-10 | An edge function shall send the transcript to Claude **together with the group's current record** as context, and shall demand strict JSON matching the extraction contract in §7.3 — no prose, no markdown fences. | Must |
| FR-RSVP-11 | The extraction prompt shall instruct the model to emit `null` rather than guess. A blank flight number costs a five-second call; a hallucinated one sends a car to the wrong airport. | Must |
| FR-RSVP-12 | A human review screen shall display transcript and extraction side by side. Fields below ~0.8 confidence shall render amber and unconfirmed. | Must |
| FR-RSVP-13 | Guest records shall be updated **only** through `apply_rsvp_extraction()` after human confirmation. No automatic write path shall exist. | Must |
| FR-RSVP-14 | The caller shall be able to edit every extracted field before commit. | Must |
| FR-RSVP-15 | The system shall record RSVP status, confirmed PAX, arrival and departure legs, and special requests. | Must |
| FR-RSVP-16 | A calling dashboard shall show progress: called, confirmed, declined, pending, unreachable, callbacks due. | Should |

### 6.3 Room allocation

| ID | Requirement | Priority |
|---|---|---|
| FR-ROOM-01 | The system shall store hotels and rooms with capacity, and assign rooms to guest groups. | Must |
| FR-ROOM-02 | Room number shall be unique per hotel. | Must |
| FR-ROOM-03 | Overlapping assignment of the same room shall be prevented by a Postgres `EXCLUDE` constraint using `btree_gist` over the check-in/check-out range. Double-booking shall be impossible at the database level, not merely discouraged in the UI. | Must |
| FR-ROOM-04 | Assigning a group larger than a room's capacity shall be blocked by a database guard. | Must |
| FR-ROOM-05 | Assignments shall record check-in date/time and check-out date/time. | Must |
| FR-ROOM-06 | The client shall be able to view the guest → group → hotel → room chain read-only. | Must |
| FR-ROOM-07 | Room occupancy shall be exportable to Excel. | Should |

### 6.4 Arrival, departure and logistics

| ID | Requirement | Priority |
|---|---|---|
| FR-LOG-01 | Arrival and departure shall be stored as `travel_legs` rows with date, time, mode (air / train / bus / car), reference (flight or train number), point and PAX. | Must |
| FR-LOG-02 | The system shall provide an arrivals board grouped by date and mode, and a mirrored departures board. | Must |
| FR-LOG-03 | The system shall record pickup and drop points per leg. | Must |
| FR-LOG-04 | The system shall manage trips: vehicle, driver, passengers, scheduled time and expense. | Must |
| FR-LOG-05 | The system shall recommend a vehicle class based on PAX, per the capacity table in §6.5, while allowing manual override. | Should |
| FR-LOG-06 | Assigning passengers beyond a vehicle's capacity shall be blocked. | Must |
| FR-LOG-07 | Logistics data shall be exportable to Excel. | Should |

### 6.5 Vehicle capacity reference

| Vehicle class | Capacity |
|---|---|
| Sedan | 3 |
| Family SUV | 4 |
| Tempo Traveller | 17–24 |
| Bus | 34–56 |

### 6.6 Hampers and return gifts

Hampers and return gifts share one `deliverables` table distinguished by a `kind` enum. All requirements below apply to both kinds.

| ID | Requirement | Priority |
|---|---|---|
| FR-DEL-01 | The system shall assign deliverables to a guest group, recording kind, type, quantity and status (pending / assigned / delivered). | Must |
| FR-DEL-02 | Delivery shall require a photograph captured **through the app**. Gallery selection shall not satisfy the proof requirement. | Must |
| FR-DEL-03 | `delivery_proofs` shall be **insert-only**. UPDATE and DELETE shall be blocked by database rule for every role including `admin`. | Must |
| FR-DEL-04 | Each proof shall carry two timestamps: `client_taken_at` (what the device claims) and `server_recorded_at` (`default now()`, never client-settable). Only the server timestamp is evidence. | Must |
| FR-DEL-05 | The sole permitted mutation is that an `admin` may set `disputed` and `dispute_note`. The proof itself, its photo and its timestamps remain immutable. | Must |
| FR-DEL-06 | Proof photos shall be stored at paths beginning with the event id (`delivery-proofs/{event_id}/...`) to satisfy bucket tenancy policies. | Must |
| FR-DEL-07 | Photo capture shall work offline: the image queues locally and uploads on reconnection, with the server timestamp assigned at insert. | Must |
| FR-DEL-08 | The system shall record who delivered each item. | Must |
| FR-DEL-09 | The client shall be able to view delivery status and the proof photograph for any group. | Must |
| FR-DEL-10 | The system shall report undelivered deliverables by group, room and hotel. | Must |

**Rationale for FR-DEL-03 through FR-DEL-05.** Guests sometimes claim a hamper was never received. The record must be unfalsifiable in both directions — staff cannot backdate a delivery, and no one can quietly erase one.

### 6.7 WhatsApp messaging

| ID | Requirement | Priority |
|---|---|---|
| FR-MSG-01 | The system shall send templated WhatsApp messages via a BSP-fronted Meta Cloud API. | Must |
| FR-MSG-02 | Message templates shall be stored in `message_templates` with variable placeholders. | Must |
| FR-MSG-03 | Every send shall be logged in `messages` with recipient, template, variables, status and provider message id. | Must |
| FR-MSG-04 | Delivery status callbacks shall be recorded where the provider supplies them. | Should |
| FR-MSG-05 | v1 shall ship **three** approved templates: RSVP request, arrival/room confirmation, and a general event update. Remaining categories shall be added only if schedule permits. | Must |
| FR-MSG-06 | Bulk send shall be rate-limited and resumable. | Should |

Deferred template categories: RSVP confirmation, departure information, logistics detail, separate bride-side and groom-side variants, room allocation as a standalone message.

### 6.8 Excel import and export

| ID | Requirement | Priority |
|---|---|---|
| FR-XLS-01 | The system shall import `CALLING_MASTER_LIST.xlsx` with a column mapper that the user confirms before commit. | Must |
| FR-XLS-02 | Import shall be **idempotent**: re-running the same file shall change nothing. Idempotency shall be keyed on a per-row hash recorded in `import_rows`. | Must |
| FR-XLS-03 | Mobile numbers shall be normalised — decimal artefacts stripped, `+91` removed, last 10 digits retained. | Must |
| FR-XLS-04 | Import shall present a preview of inserts, updates and skips before writing. This screen shall not be cut under schedule pressure. | Must |
| FR-XLS-05 | Every import shall be recorded as an `import_batches` row with counts and the operator. | Must |
| FR-XLS-06 | The system shall export guest list, room allocation, logistics and calling status to Excel. | Must |

### 6.9 Client dashboard and road view

| ID | Requirement | Priority |
|---|---|---|
| FR-DASH-01 | The dashboard shall display these eight counters in v1: total guests, total PAX, RSVP confirmed, RSVP pending, arrivals today, departures today, rooms allocated, hampers pending. | Must |
| FR-DASH-02 | Remaining counters — rooms pending, vehicles assigned, logistics pending, hampers delivered, return gifts delivered, return gifts pending — shall be added in the final phase if schedule permits. | Could |
| FR-DASH-03 | The road view shall show, per group: name, PAX, room number, arrival date/time and mode, departure, family head, hamper status and return-gift status. | Must |
| FR-DASH-04 | The client shall access the road view through `client_guest_profiles` only, and shall have no access to any base table. | Must |

### 6.10 Audit and reporting

| ID | Requirement | Priority |
|---|---|---|
| FR-AUD-01 | A generic trigger shall write every insert, update and delete on core tables to `audit_log`, capturing table, record id, action, old and new JSON, actor (`auth.uid()`) and server timestamp. | Must |
| FR-AUD-02 | Audit logging shall be implemented as database triggers, not application-layer logging. | Must |
| FR-AUD-03 | Admins shall be able to view the audit trail for any record. | Should |
| FR-AUD-04 | The system shall produce operational reports: RSVP funnel, arrivals and departures by day, room occupancy, undelivered hampers, undelivered return gifts, vehicle utilisation and logistics expense. | Should |

---

## 7. External interfaces

### 7.1 WhatsApp Business API

Accessed through an Indian BSP. Requires business verification and per-template approval before any message can be sent. **This dependency shall be started on day one of the messaging phase** — approval latency, not development time, is the critical path.

### 7.2 Speech-to-text

Provider sits behind an interface so that swapping it is a one-file change. Sarvam Saarika and Google STT v2 shall both be trialled on at least three real recordings before commitment; code-switched Gujarati is where the two diverge most.

### 7.3 Claude extraction contract

The extraction function shall return exactly this shape and nothing else:

```json
{
  "rsvp_status": "confirmed|declined|tentative|callback|unreachable",
  "confirmed_pax": 6,
  "arrival":   {"date": "2026-12-20", "time": "10:30", "mode": "air",
                "reference": "6E 5074", "point": "Ahmedabad T2", "pax": 6},
  "departure": {"date": null, "time": null, "mode": null,
                "reference": null, "point": null, "pax": null},
  "special_requests": "wheelchair for mother",
  "language": "gu",
  "confidence": {"rsvp_status": 0.95, "confirmed_pax": 0.88,
                 "arrival.date": 0.71, "arrival.reference": 0.40}
}
```

Supplying the group's current record as context is what allows the model to resolve *"same as last time"*, *"do divas pehla"*, DD/MM ambiguity and *"saade das"* → `10:30`.

### 7.4 Telephony

`tel:` deep links only. If cloud telephony is adopted later, it shall include a consent announcement before recording connects and number masking, so that 238 families do not acquire the callers' personal numbers.

---

## 8. Non-functional requirements

### 8.1 Reliability and offline behaviour

| ID | Requirement |
|---|---|
| NFR-REL-01 | Check-in, hamper photo capture and call outcome logging shall function with no network. Writes queue in IndexedDB and sync on reconnection. |
| NFR-REL-02 | The queue shall survive app restart and device reboot. |
| NFR-REL-03 | Sync shall be idempotent — a replayed queue shall not duplicate records. |
| NFR-REL-04 | Sync state shall be visible: staff shall always be able to see how many items are pending upload. |
| NFR-REL-05 | A printed guest list shall be maintained as the paper fallback for total system failure. |

### 8.2 Performance

| ID | Requirement |
|---|---|
| NFR-PERF-01 | Guest search shall return in under 1 second across 465 records on a mid-range Android phone. |
| NFR-PERF-02 | Check-in status shall propagate across devices within 5 seconds via Supabase Realtime. |
| NFR-PERF-03 | Initial app load on 4G shall complete within 5 seconds; subsequent loads shall be served from cache. |

### 8.3 Security

| ID | Requirement |
|---|---|
| NFR-SEC-01 | RLS shall be enabled on every table. No table shall be reachable without a policy. |
| NFR-SEC-02 | Storage buckets shall be private; access shall be via signed URLs only. |
| NFR-SEC-03 | Service-role keys shall never reach the client bundle. |
| NFR-SEC-04 | Guest mobile numbers shall be visible to admin and event_team only. |
| NFR-SEC-05 | Call recordings shall be retained in a private bucket and purged on a defined schedule after the event. |

### 8.4 Usability

| ID | Requirement |
|---|---|
| NFR-USE-01 | Base font 16px; tap targets minimum 44px. |
| NFR-USE-02 | Every screen shall be operable one-handed on a 5-inch display. |
| NFR-USE-03 | Any staff task shall be reachable in three taps or fewer from the home screen. |
| NFR-USE-04 | Error messages shall state what to do next, not what failed internally. |

### 8.5 Maintainability

| ID | Requirement |
|---|---|
| NFR-MNT-01 | Schema changes shall be delivered as ordered, idempotent migration files. |
| NFR-MNT-02 | Security guarantees shall be covered by an executable test suite (`test_security.sql`). |
| NFR-MNT-03 | Staging and production Supabase projects shall be kept separate. |

---

## 9. Integrity guarantees

Five guarantees. Each is enforced in the database, and each has a test.

| # | Guarantee | Enforced by | Test |
|---|---|---|---|
| 1 | Every row belongs to exactly one event and cannot reference another | `event_id` on all tables; composite FKs `(child_id, event_id)`; RLS via `app.is_staff(event_id)` | Cross-event insert is rejected |
| 2 | Hamper and return-gift proofs cannot be altered or removed | Insert-only rules on `delivery_proofs`; DELETE blocked for all roles | Update and delete both fail |
| 3 | Delivery time cannot be faked | `server_recorded_at default now()`, not client-settable | A device claiming the year 2020 is still stamped with real server time |
| 4 | A room cannot be double-booked, nor over-filled | `EXCLUDE` constraint with `btree_gist`; capacity guard trigger | Overlapping assignment rejected; over-capacity rejected |
| 5 | Two callers cannot work the same group | `claim_group()` lock with expiry | Second caller's claim fails |

---

## 10. Delivery phases

| Phase | Content | Status |
|---|---|---|
| **1 — RSVP & calling** | Schema, RLS, audit triggers → Excel import → auth and role routing → calling queue → call screen → recording module → upload/transcribe/extract → review screen → Excel export | In progress |
| **2 — Rooms** | Hotels, rooms, assignment UI, double-booking prevention, client room view | Planned |
| **3 — Hampers & return gifts** | Deliverables, photo capture with offline queue, proof viewer, dispute handling | Planned |
| **4 — Logistics & departure** | Travel legs, arrivals/departures boards, vehicles, trips, expense | Planned |
| **5 — Ship** | WhatsApp, client dashboard, Capacitor APK, dry runs, feature freeze, cutover, staff training | Planned |

### 10.1 Phase 1 build lines

| Line | Deliverable | Done when |
|---|---|---|
| `p1a` | Schema, RLS, audit triggers | ✅ 7 migrations, ~1,663 lines, clean on Postgres 16; covers all 19 requirement sections |
| `p1b` | `test_security.sql` | ✅ 8 tests passing |
| `p1c` | Excel import | Re-running the same file changes nothing |
| `p1d` | Auth, event switching, role routing | Each role lands on its correct home screen |
| `p1e` | Calling queue with locking | Two devices cannot open the same group |
| `p1f` | Call screen, `tel:` dial, outcome logging | Works in airplane mode, syncs on reconnect |
| `p1g` | Native call-recording module | Recording captured on the team's actual handsets |
| `p1h` | Upload, transcribe, extract | Ten real notes produce correct JSON |
| `p1i` | Review and commit screen | Caller can correct every field before save |
| `p1j` | Excel export and calling dashboard | 20 real calls end-to-end |

### 10.2 Pre-launch discipline

- **Two dry runs** with real staff on real phones, including deliberate chaos: guest not in list, phone dies mid-check-in, wrong room assigned.
- **Feature freeze** after the second dry run. Bug fixes only. This rule is not negotiable — late features are how event-day failures happen.
- **Production cutover**: final Excel import with room allocations, counts verified against the sheet, 20 random guests spot-checked, all staff accounts created, APK distributed.
- **Staff training**: 30 minutes per role on their own phones. Hamper staff practise the photo flow five times each. One-page printed cheat sheets per role.

### 10.3 Scope-cut priorities

If time runs short, cut in this order: dashboard counters 9–14 → WhatsApp templates beyond the first three → vehicle recommendation → logistics expense tracking → reports.

**Never cut:** Excel import preview · check-in · hamper photo proof · realtime sync · the human review screen.

---

## 11. Acceptance criteria

The system is accepted when all of the following hold on production data:

1. All 238 groups and 465 guests import from the master Excel with counts matching the sheet exactly, and a second import of the same file changes nothing.
2. A caller completes a call end-to-end — dial, record, transcribe, extract, review, commit — and the guest record reflects exactly what was confirmed on the review screen.
3. A `client` login sees the road view and zero rows from every base table.
4. A hamper photo captured in airplane mode uploads on reconnection and carries a server timestamp, and neither an admin nor a staff member can subsequently alter or delete it.
5. Two devices cannot claim the same calling group, and two assignments cannot overlap on the same room.
6. Every mutation on core tables appears in `audit_log` with the correct actor.
7. The APK installs on the team's actual handsets and every staff flow works on them.
8. Two dry runs are completed and every defect found is either fixed or explicitly accepted.

---

## 12. Open decisions and risks

### 12.1 Open decisions

| ID | Decision | Impact if unresolved |
|---|---|---|
| OD-01 | **PAX versus named guests.** The source notes treat PAX as a count in some sections and as a set of named guests in others. The system currently supports both — a group carries `expected_pax` / `confirmed_pax`, and `guests` holds names where known. Confirm which is authoritative for room and vehicle sizing. | Room and vehicle counts may not reconcile with the guest list |
| OD-02 | **Event date.** Determines whether the RSVP calling phase or room allocation leads the remaining build sequence. | Build order may be wrong |
| OD-03 | **STT provider.** Sarvam Saarika versus Google STT v2, to be settled on real recordings. | Blocks `p1h` |
| OD-04 | **WhatsApp BSP.** AiSensy, Interakt or Gupshup. | Blocks the entire messaging phase; start verification early |
| OD-05 | **Call-recording retention period** after the event. | Privacy and storage cost |

### 12.2 Risks

| ID | Risk | Mitigation |
|---|---|---|
| RISK-01 | Android 13+ blocks automatic call recording on some handsets. There is no code fix. | Test on the team's actual phones before building the recording module. In-app post-call voice note is the designed fallback, and the rest of the pipeline works identically either way. |
| RISK-02 | WhatsApp template approval delays past the deadline. | Start BSP verification immediately; ship the three highest-value templates only. |
| RISK-03 | Venue network fails on event day. | Offline queue plus printed guest list fallback. |
| RISK-04 | Guest list changes after cutover. | Idempotent import means re-import is safe at any time. |
| RISK-05 | Single developer under a hard deadline. | Documented scope-cut order (§10.3) and enforced feature freeze. |

### 12.3 Known implementation traps

- Storage paths **must** begin with the event id — bucket policies read the first folder segment as the tenant key. A wrong path is a rejected upload.
- Excel import must create a `guests` row for the family head. The client profile card view reads from `guests`; heads-only groups render blank.
- `tel:` backgrounds the browser and Android may discard page state. Persist the call attempt before dialling and rehydrate on resume.

---

## 13. Traceability to source notes

| Source section | Covered by |
|---|---|
| 1. RSVP Management | FR-RSVP-01…16 |
| 2. Guest Registration | FR-GRP-01…04, §5.2 |
| 3. Guest Groups | FR-GRP-06 |
| 4. Family Head System | §5.2, FR-GRP-02, FR-GRP-03 |
| 5. WhatsApp Messaging | FR-MSG-01…06 |
| 6. Bride / Groom Classification | FR-GRP-05 |
| 7. Room Allocation | FR-ROOM-01…07 |
| 8. Client Road View | FR-DASH-03, FR-DASH-04 |
| 9. Logistics Management | FR-LOG-01…07 |
| 10. Vehicle Allocation | FR-LOG-04…06, §6.5 |
| 11. Hamper Management | FR-DEL-01…10 |
| 12. Hamper Room Access | FR-DEL-09, FR-ROOM-06 |
| 13. Return Gift Management | FR-DEL-01…10 (`kind = return_gift`) |
| 14. Excel Management | FR-XLS-01…06 |
| 15. Client Dashboard | FR-DASH-01, FR-DASH-02 |
| 16. Guest Management Module | §5.1, §5.2 |
| 17. Proposed Software Modules | §10 |
| 18. Core Guest Record | §5.2 |
| 19. Overall Workflow | §10, §4.3 |

---

*End of document.*
