# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 1. What this project is

A multi-tenant event operations platform for a large Indian wedding, replacing Excel
sheets, Google Forms, manual calling records, and manual room/hamper/logistics tracking.

- **Scale:** ~238 family groups, ~465 guests (from `CALLING_MASTER_LIST.xlsx`)
- **Users:** 10–20 event staff on cheap Android phones, plus the client (read-only)
- **Hard deadline:** submission by **26 August 2026**
- **Who writes the code:** Prince, driving Claude Code. Assume the human is a competent
  web developer with **no prior mobile app experience**.

---

## 2. Repository state

**This repo currently contains SQL only. The application has not been scaffolded yet.**

```
CLAUDE.md
SCHEMA_GUIDE.md
20260731000100_foundation.sql          extensions, enums, tenancy, helpers, audit
20260731000200_guests_rsvp.sql         guest_groups, guests, travel_legs, call chain
20260731000300_rooms_deliverables.sql  hotels, rooms, assignments, deliverables, proofs
20260731000400_logistics_messaging.sql vehicles, trips, messages, import batches
20260731000500_rls.sql                 all RLS policies + storage buckets
20260731000600_views_rpc.sql           4 views + 3 RPCs
20260731000700_seed.sql                vehicle types + message templates
test_security.sql                      8 security tests
```

Facts a new session needs before touching anything:

- **No `package.json`, no `supabase/` directory, no Next.js app.** The next code written
  here is the first application code in the project.
- **Not a git repository.** `git init` is still pending, despite §14 saying to commit each session.
- **Migrations live at the repo root, not in `supabase/migrations/`.** They must be moved
  there (or copied) before `supabase db push` will see them.
- **`CALLING_MASTER_LIST.xlsx` is not in the repo.** `p1c` needs it; ask for it before starting.
- **The migrations have not been applied to the live Supabase project.** They were applied
  and tested against a separate Postgres instance. See §3.

---

## 3. Commands

There is no global `supabase` binary on this machine — **always invoke it through `npx`.**

```bash
npx supabase --version
npx supabase projects list          # confirms which account is logged in
npx supabase orgs list
```

Supabase project (cloud):

| | |
|---|---|
| Project | Nuvent |
| Ref | `xktxnkuzplhzxkevwrcj` |
| Org | Varunya Technologies (`cuwsovksnpfsoaonyteg`) |
| Region | ap-northeast-2 |
| Postgres | **17.6.1.155** — note, not 16 |
| Linked | **no** |

First-time setup, not yet done:

```bash
npx supabase init
npx supabase link --project-ref xktxnkuzplhzxkevwrcj
mkdir -p supabase/migrations && mv 2026*.sql supabase/migrations/
npx supabase db push
```

Running the security suite — `test_security.sql` is written for a **scratch database**. It
creates two events and four users and asserts against them. Do not run it against a database
holding real guest data.

```bash
npx supabase db reset                              # local stack, wipes and replays migrations
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test_security.sql
```

Once the Next.js app exists, record its `dev` / `build` / `lint` / `test` commands here —
this section is the first place a new session looks.

### Mobile (Capacitor)

**Mode: REMOTE SHELL (M2-ALT).** The static-export audit returned HEAVY, so the APK is a
native shell over the deployed site, not a static bundle. **Offline support is NOT available
in this mode** — venue Wi-Fi is a single point of failure until M9 lands a client data layer.
The WebView URL comes from **`CAP_SERVER_URL`** (there is no `CAP_REMOTE_URL`; that name
appeared only in this file). It defaults to `http://localhost:3000`, and `<DEPLOYED_APP_URL>`
is still a placeholder — set `CAP_SERVER_URL` before building the release APK.

#### Running it on a phone — read this before anything else

```bash
npm run mobile:dev        # the ONLY supported way to run on a handset
```

That script (`scripts/mobile-dev.mjs`) detects the LAN IP, starts `next dev` on 0.0.0.0,
waits for it to answer, rebuilds + installs **only if the baked URL changed**, and launches
`com.nuvent.app/.MainActivity`. Override the IP with `CAP_DEV_HOST` if auto-detection picks a
virtual adapter.

**Do NOT open the LAN URL in the phone's browser, and do NOT run
`adb shell am start -a android.intent.action.VIEW -d http://...`.** Both give you a Chrome tab,
not the app. In a browser tab there is no native bridge, so `Capacitor.isNativePlatform()` is
false, the `Call` plugin does not exist, and dialing degrades to browser behaviour. This has
cost the project a full debugging session already — see "Known traps".

`npm run mobile:launch` just re-launches the installed APK without touching the build.

**Toolchain (verified Aug 2026):** the only JDK installed is **JDK 17** at
`C:\Program Files\Java\jdk-17` — an earlier note here claimed JDK 26 at `jdk-26.0.2`, which
does not exist on this machine. JAVA_HOME only launches the Gradle wrapper; the build itself
runs on the Temurin 21 pinned by `org.gradle.java.home` in `android/gradle.properties`
(auto-downloaded to `~/.gradle/jdks`). Android SDK at
`C:\Users\rebel\AppData\Local\Android\Sdk`. Gradle wrapper **9.4.0**. Do not revert the
`gradle.properties` toolchain settings or the build breaks.

```bash
# manual debug build (mobile:dev does this for you)
export JAVA_HOME="C:/Program Files/Java/jdk-17"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
cd android && ./gradlew.bat assembleDebug    # -> app/build/outputs/apk/debug/app-debug.apk

# production: set the real URL, then
CAP_SERVER_URL=https://<real-host> npm run mobile   # next build + cap sync android
cd android && ./gradlew.bat assembleRelease
```

If `adb install` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the installed build was
signed with a different debug keystore — `adb uninstall com.nuvent.app` first. That clears the
session, so the phone needs one re-login.

Debug vs release cleartext: **`android/app/src/debug/AndroidManifest.xml`** adds
`usesCleartextTraffic` and is merged into debug builds only. (An earlier note credited
`capacitor.config.dev.ts` — that file was orphaned, read by nothing, and has been deleted.)
The release manifest must never contain `usesCleartextTraffic` — grep the **merged** manifest
under `android/app/build/intermediates/merged_manifest/` before shipping, not just the source.

Native code (M6 dialer, M7 recorder, M8 camera proof) lives in
`android/app/src/main/java/com/nuvent/app/` — the package was renamed from `com.eventops.app`.
Any change there, to `AndroidManifest.xml`, or to the plugin list requires a full APK rebuild —
OTA (M11) ships JS/HTML/CSS only.

### Deployment — Vercel (live since 2026-08-10)

| | |
|---|---|
| URL | `https://nuvent-ppzhi25o0-rebelmaker1258-2015s-projects.vercel.app` |
| Project | `nuvent`, scope `rebelmaker1258-2015s-projects`, id `prj_MOyao678WL7786GHPQh5XH9JLm98` |
| Region | **`icn1` (Seoul)** — set in `vercel.json` |
| Verified by | `X-Vercel-Id: bom1::icn1::…` — request enters the Mumbai edge, the function runs in Seoul |

Seoul was chosen to sit beside Supabase (`ap-northeast-2`): the admin dashboard makes
~10 sequential DB calls per load, and from Mumbai each crossed ~6,000km. **This trade-off
is unproven for the guest list**, which makes few DB calls and is dominated by the
user↔server leg instead — deployed S1 timings were 7.4s and 9.9s against a 5s budget.
Those were measured from a laptop whose own link varies wildly (TTFB 0.58s–6.5s on the
same URL), so they do not settle it. Measure from a phone on mobile data before changing
the region; `bom1` is the alternative if the guest list is the page that matters most.

**Env vars live in Vercel, never in the repo.** Only three exist:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (both public by design) and
`APP_JWT_SECRET` (server-only, verifies code-auth JWTs). The service-role key and
`SARVAM_API_KEY` are **not** here and must never be — the app never uses them; they live
in Supabase Edge Function secrets. Client bundle verified clean against all of them.

**Deployment Protection must stay OFF.** It was on by default
(`ssoProtection: all_except_custom_domains`) and every request 302'd to `vercel.com/sso-api`
— staff would have hit a Vercel login wall. Disabled via the API; re-check after any
project settings change.

**Rollback:** `npx vercel ls` to list deployments, then
`npx vercel rollback <deployment-url>` — or promote an older one from the dashboard's
Deployments tab. Each deployment keeps its own immutable URL, so the previous build is
always reachable even before promoting it.

**`.vercelignore` matters.** Without it the upload was 90MB (mostly `android/` and
`.next/`) and never finished on this connection. It is a few MB now.

#### Cloudflare Pages — BLOCKED, revisit later

Not a configuration problem, a hard incompatibility:

- Next 16 renamed middleware to `proxy.ts` and made it **Node-runtime only** — setting
  `runtime: 'edge'` fails the Next build with "Proxy does not support Edge runtime".
- `@opennextjs/cloudflare` **refuses Node middleware** — hard-coded in
  `dist/cli/build/build.js:67`, no flag, no opt-out.

The only route through is deleting `src/proxy.ts` and relocating `updateSession()`, i.e.
rewriting session refresh. `wrangler.jsonc` and `open-next.config.ts` are committed and
inert, with Smart Placement already declared, ready for when the adapter supports Node
middleware.

### Release build (M10) — run on a machine with Android Studio + JDK

**DONE 2026-08-10 — the release pipeline is wired and a signed APK exists.**

```
APK      android/app/build/outputs/apk/release/app-release.apk   6,142,584 bytes
Download https://xktxnkuzplhzxkevwrcj.supabase.co/storage/v1/object/public/app-releases/nuvent-1.0.apk
sha256   b274872035226ccbbef322a9899a114b9648914528eeca264fa19b0a032fbf84
Signer   CN=Nuvent, O=Varunya Technologies, L=Surat   SHA-256 e865d4c1b3865da6…
```

**⚠ LOSING THE KEYSTORE MEANS EVERY PHONE MUST UNINSTALL AND REINSTALL.** Android
identifies an app by its signature; a differently-signed build cannot upgrade an installed
one. Mid-event that means every staff member stops, uninstalls, reinstalls and logs in
again. Backed up in two places, checksums verified identical:

```
C:\Users\rebel\NuventKeys\                 local, not synced
C:\Users\rebel\OneDrive\NuventKeys-backup\ syncs off-machine
```

Both hold `nuvent-release.jks` + `keystore.properties`. `*.jks`, `*.keystore` and
`android/keystore.properties` are gitignored; only `keystore.properties.example` is
tracked. **A third copy on separate physical media is still worth making.**

Things that are already true and should not be re-derived:

- `cleartext` is **derived**, not hardcoded: `!serverUrl.startsWith('https://')` in
  `capacitor.config.ts`. A release on https gets `false`; `npm run mobile:dev` on a
  `http://<LAN_IP>:3000` still gets `true` and keeps working. Hardcoding either value
  breaks one of the two.
- The release build **throws** if `android/keystore.properties` is missing rather than
  falling back to debug signing — see the warning above for why that fallback is a trap.
- `minifyEnabled true` + `shrinkResources true`, with Capacitor keep rules in
  `proguard-rules.pro`. Capacitor registers plugins by reflection, so without them R8
  strips the classes and the plugin silently does not exist — no crash, no log, the JS
  call just never resolves.
- Verified on the **merged** manifest (`merged_manifest/release/…`), not the source:
  `usesCleartextTraffic` ABSENT, `debuggable` ABSENT, `<queries>` + `tel:` PRESENT.

Original steps, kept for reference:

1. `keytool` the keystore, store it OUTSIDE the repo in two places.
   Copy `android/keystore.properties.example` → `android/keystore.properties`.
2. Wire `signingConfigs` in `android/app/build.gradle` to read that file; the
   build must fail loudly if it is missing — never fall back to debug signing
   for a release build.
3. Release build: `minifyEnabled true`, `shrinkResources true`, ProGuard keep
   rules for Capacitor plugin classes + `CallPlugin` (reflection-based plugin
   registration breaks under R8). Verify the release manifest has NO
   `usesCleartextTraffic` and NO `debuggable`.
4. Upload the ProGuard mapping file to Sentry for readable release traces.
5. Install page lives at `public/install.html`; copy it + the APK into the
   `delivery-proofs`-style public bucket (or any static host) and share the URL.
   Do NOT distribute the APK as a WhatsApp attachment — it gets compressed,
   renamed, and staff end up on mismatched versions.
6. In-app version check: on launch, fetch a `version.json` from the bucket;
   if installed versionCode is behind, show a non-dismissible update prompt
   linking to the install page.

### OTA hotfix channel (M11)

- Ships **JS/HTML/CSS only** via `@capgo/capacitor-updater` (self-hosted on a
  storage bucket). Any change to native code (`CallPlugin`, permissions,
  `AndroidManifest`, gradle, a new Capacitor plugin) requires a full APK
  redistribution — plan native changes to be finished before distribution day.
- `autoUpdate` is OFF; `OtaUpdater` drives `getLatest → download → next` on
  app resume so the bundle stages for the next background/restart, never a
  mid-session hot-swap.
- Rollback: previous bundles are kept; the /debug screen can reset to the last
  good bundle.
- Release script: `node scripts/ota-release.mjs <versionName> [versionCode]`
  (builds `out/`, zips, uploads to the bucket, writes `manifest.json`). Only
  runnable once `out/` exists — i.e. after M2 lands. In remote-shell mode the
  deployed site is the source of truth.

---

## 4. Stack (locked — do not re-litigate)

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions, Realtime) |
| Mobile | PWA first, then **Capacitor** wrap into an APK — **not** Expo, **not** React Native |
| Distribution | APK sent to staff over WhatsApp. **No Play Store submission.** |
| Excel | SheetJS. Import + export only. Postgres is truth, Excel is an interface. |
| STT | Sarvam Saarika or Google STT v2 (gu-IN + hi-IN + en-IN) |
| Extraction | Claude → strict JSON with per-field confidence |

Capacitor was chosen over Expo specifically because it wraps the existing Next.js web app,
so almost nothing new has to be learned under deadline pressure.

---

## 5. Non-negotiable architectural rules

Enforced at the **database level**, not in application code. Do not weaken them.

1. **Every table is fenced by `event_id`.** RLS uses `app.is_staff(event_id)`. Child tables
   use composite foreign keys `(child_id, event_id)` referencing a `unique (id, event_id)`
   on the parent — so a row physically cannot point at a parent in a different event.
2. **`delivery_proofs` are insert-only.** No update policy, no delete policy,
   `revoke update, delete ... from authenticated`, plus `app.block_mutation()` triggers on
   both. The triggers are unconditional, so **not even an admin or the service role can
   delete one.**
3. **Server clock only.** `app.force_server_recorded_at()` overwrites `recorded_at` with
   `now()` on every insert to `delivery_proofs` and `call_recordings`. The phone's claim is
   kept in `device_captured_at`, marked untrusted. `call_attempts` uses
   `app.force_server_started_at()`, which moves the submitted value into `device_started_at`
   and stamps `started_at` from the server.
4. **`call_attempts` is append-only with one-shot completion.** Not fully insert-only —
   UPDATE is permitted so a caller can write `ended_at` and `outcome` when the call finishes.
   The moment `outcome` goes from null to non-null, `app.guard_call_attempt()` stamps
   `finalized_at` and the row freezes permanently. Identity columns (`id`, `event_id`,
   `group_id`, `caller_id`, `dialed_number`, `started_at`) are force-restored to their old
   values on every update. DELETE is blocked by trigger and revoked grant.
   **Attempt count is `count(*)`, never a stored counter** — stored counters drift.
5. **Audit logging via triggers**, not application code. `app.attach_standard_triggers()`
   attaches an audit trigger, plus a `touch_updated_at` trigger where an `updated_at` column
   exists. Coverage is **not universal** — see §10.
6. **Excel import is idempotent.** `guest_groups.source_row_hash` is unique per event via a
   partial index. Re-running the same file changes nothing. Exported rows carry hidden ids
   so a re-import matches instead of duplicating.
7. **Offline-first for field screens.** IndexedDB outbox queue that drains when signal
   returns. Venue Wi-Fi will fail.
8. **The review screen is non-negotiable.** Transcripts and extractions are *evidence*;
   only a human-reviewed commit becomes data. Fields below ~0.8 confidence render amber.
   Nothing auto-writes. `apply_rsvp_extraction()` is the only path from AI output into
   guest data.
9. **Paired attribution columns — `_staff` siblings.** A code-auth (team) session has no
   `auth.uid()`; its identity is the selected `staff_members.id`. Every attribution column
   (`locked_by`, `caller_id`, `created_by`, `uploaded_by`, `assigned_by`, `imported_by`)
   therefore has a nullable `_staff` sibling (`locked_by_staff`, `caller_id_staff`, ...) with
   `ON DELETE RESTRICT` to `staff_members(id)`. Rules:
   - A `CHECK` (`num_nonnulls(pair) <= 1`, or `= 1` where the column was NOT NULL) makes
     double-attribution impossible — "who did this" is always answerable.
   - A `BEFORE INSERT` trigger (`app.route_attribution`) writes the staff column for a
     team session (`jwt_staff_member_id` present) and the auth column for an admin.
   - **`delivery_proofs` was the exception, not the precedent.** Until
     `20260809130000` it had *neither* the CHECK nor the trigger, while this section
     claimed it set the pattern. L1 found a team session could write a proof carrying
     **both** `captured_by` and `captured_by_staff` — and proofs are insert-only, so the
     row could never be corrected. That migration adds the `delivery_proofs` branch to
     `route_attribution`, drops the stale `app.current_identity()` defaults, and requires
     `captured_by is null` in the insert policy. **The pair CHECK is still missing**: two
     live rows have neither column set and cannot be repaired or deleted. See `TEST-LOG.md`.
   - `app.route_attribution` dispatches on `TG_TABLE_NAME`. Attaching it to a new table
     without adding a branch silently does nothing — it falls through to `return NEW`.
   - `claim_group` / `release_group` write/clear the lock pair.
   - Read paths (the call/RSVP "in-flight" checks, "you" labels, the export's `deliveredBy`)
     resolve whichever column is populated — never assume one.
   - Do NOT re-point these to a single FK: a team id is not an auth user and vice versa
     (the original `23503`). Add a sibling column, don't drop the FK.

---

## 6. Domain model decisions (settled — build against these)

- **The calling unit is the group, not the guest.** You dial one number and the family head
  answers for six people. PAX lives on `guest_groups` (`expected_pax` / `confirmed_pax`),
  not scattered across individual guests. The SRS contradicts itself here; the group wins.
- **The caller lock is dormant (2026-08-12).** `claim_group()`, `release_group()`, and
  `locked_by`/`locked_until` columns still exist in the database but are NOT called from
  any client code path. Two handsets can open the same family simultaneously. Presence is
  now non-blocking: `last_opened_by_staff` / `last_opened_at` on `guest_groups` are
  fire-and-forget and surfaced as quiet text on the queue row. The attribution CHECK on
  `call_attempts` (`num_nonnulls(caller_id, caller_id_staff) = 1`) is NOT the lock and
  is NOT negotiable — it must never be softened.
- **Individual member names are collected later**, at room allocation — not over the phone.
- **Hampers and return gifts are the same shape.** One `deliverables` table with a `kind`
  enum, one insert-only `delivery_proofs` table. Do not build it twice.
- **Groups are locked to a caller for 15 minutes** on open (`claim_group()` defaults to
  `p_minutes => 15`). With a 10-person calling team, two people *will* dial the same uncle.
  **DORMANT as of 2026-08-12** — the call path no longer uses this. See above.
- **`travel_legs` holds arrival and departure in one table**, so arrivals-vs-departures
  reconciliation is one query (`v_travel_ledger`).
- **Fleet is live inventory and capacities are luggage-adjusted.** The sticker number lies:
  traveller 17→14, 20→17, 24→20, 33→29. Buses seeded at 30 and 50 — **placeholder, unconfirmed.**
- **Vehicle suggestion is advisory.** Greedy PAX fit, always human-overridable.
- **No custom dialer.** `tel:` deep link + one-tap outcome logging
  (Confirmed / Declined / No answer / Callback / Wrong number).

---

## 7. Roles and access model

Exactly three roles. There is no fourth role and no global "see everything" switch except
`profiles.global_role = 'admin'`.

| | admin | event_team | client |
|---|---|---|---|
| Scope | every event | one event | one event |
| Base tables | read + write + delete | read + insert + update | **nothing** |
| Views | all | staff views | `client_guest_profiles` only |
| Can see other events exist? | yes | no | no |
| Can delete anything? | yes (except proofs) | no | no |

A client login querying `guest_groups` gets **zero rows**, not an error.

Helper functions, all `security definer` so policies never recurse into RLS:
`app.is_admin()`, `app.role_in_event(uuid)`, `app.is_staff(uuid)`, `app.is_member(uuid)`.
`is_staff` = admin or `event_team` on that event. `is_member` = staff or client.

Bootstrapping the first admin relies on `auth.uid()` being null from the SQL editor or a
service-role key — `app.guard_profile_role()` short-circuits in that case. Through the app,
only an admin can change `global_role`.

---

## 8. Table map

**Tenancy** — `events`, `profiles`, `event_members`, `audit_log`

**RSVP (Phase 1)** — `guest_groups`, `guests`, `travel_legs`,
`call_attempts` → `call_recordings` → `transcripts` → `rsvp_extractions`

**Rooms** — `hotels`, `rooms`, `room_assignments`

**Hampers / return gifts** — `deliverables`, `delivery_proofs`

**(Production)** — reserved, not built yet. See §8a.

**Logistics** — `vehicle_types`, `vehicles`, `trips`, `trip_passengers`

**Messaging / import** — `message_templates`, `messages`, `import_batches`, `import_rows`

**Messaging / import** — `message_templates`, `messages`, `import_batches`, `import_rows`

**Views** — `client_guest_profiles`, `v_rsvp_queue`, `v_travel_ledger`, `v_event_dashboard`

**RPCs** — `claim_group()`, `release_group()`, `apply_rsvp_extraction()`

`client_guest_profiles` is `security_invoker = false` — it runs as owner and **bypasses
base-table RLS**. Its `where app.is_member(g.event_id)` clause is the only fence. Treat any
edit to that view as a security change. The other three views are `security_invoker = true`,
so normal staff RLS applies and a client login sees nothing through them.

---

## 9. The RSVP capture pipeline

```
tel: dial → call recording (native Capacitor module) or post-call voice note
  → IndexedDB queue → Supabase Storage
  → Edge fn: STT (gu-IN + hi-IN + en-IN)
  → Edge fn: Claude → strict JSON + per-field confidence
  → REVIEW SCREEN  ← human confirms
  → apply_rsvp_extraction()  ← the only write path
  → Excel export
```

Extraction contract:

```json
{
  "rsvp_status": "confirmed|declined|tentative|callback|unreachable",
  "confirmed_pax": 6,
  "arrival":   {"date":"2026-12-20","time":"10:30","mode":"air",
                "reference":"6E 5074","point":"Ahmedabad T2"},
  "departure": {"date":null,"time":null,"mode":null,"reference":null,"point":null},
  "special_requests": "wheelchair for mother",
  "language": "gu",
  "confidence": {"rsvp_status":0.95,"confirmed_pax":0.88,"arrival.date":0.71}
}
```

**The payload the review screen sends to `apply_rsvp_extraction()` is not this shape.** The
RPC reads exactly these top-level keys and ignores everything else:

| RPC reads | Writes to |
|---|---|
| `rsvp_status` | `guest_groups.rsvp_status` |
| `confirmed_pax` | `guest_groups.confirmed_pax` |
| `side` | `guest_groups.side` |
| `remarks` | `guest_groups.remarks` |
| `arrival` / `departure` objects, keys `mode` `date` `time` `reference` `point` `pax` | `travel_legs` |

So `special_requests` must be mapped to **`remarks`**, `arrival.pax` is `pax` (not
`pax_on_leg`), and `language` / `confidence` are ignored by the RPC — persist those on the
`rsvp_extractions` row instead. Every field uses `coalesce(new, existing)`, so omitting a key
leaves the current value alone; there is no way to null a field out through this RPC.

Feed the group's **existing record** into the prompt as context — that is what resolves
"same as last time", "do divas pehla", DD/MM ordering, and "saade das" → 10:30.
Instruct the model to emit `null` rather than guess, especially on flight numbers.
A hallucinated PNR is worse than a blank.

### The STT step — `transcribe-recording` Edge Function

Sarvam Saaras v3, batch, with diarization (~₹45/hour). Key is in Edge Function secrets
only (`SARVAM_API_KEY`) — the APK is a zip file and anyone can read its strings.

**Trigger: a Database Webhook, not a direct invoke from the app.** Migration
`20260810120000_transcribe_webhook.sql` puts an `after insert` trigger on
`call_recordings` that calls the function through `pg_net`. Chosen because the phone is
the least reliable component here: a client-driven invoke fires from the same handset
that just lost signal mid-upload, so "recording committed" and "transcription attempted"
would routinely diverge with nothing recording that a transcript was ever expected.
There is also no app-side producer today — the M7 upload path is unwired, so a direct
invoke has no call site. **The trigger swallows every error**: a failure to enqueue must
never block the insert, because a recording with no transcript is recoverable and lost
audio is not.

Setup is two Vault secrets (`transcribe_webhook_url`, `transcribe_webhook_secret`) plus
the matching `TRANSCRIBE_WEBHOOK_SECRET` Edge Function secret — see the migration header.
Until those exist the trigger warns and does nothing; recordings still save.

Things that are not what you'd assume:

- **`transcripts.text` is `NOT NULL`** — a legacy column from `0200` that predates
  `full_text`. The pending row is inserted with `text = ''` before Sarvam is called, and
  both `text` and `full_text` are set on completion. Do not "fix" this by nulling `text`
  without a migration.
- **`transcripts` has no `group_id`.** It carries `event_id` and `recording_id` only; the
  group is reached via `recording_id → call_recordings.group_id`.
- **The cost counter is derived, never stored** — cumulative hours are summed from
  `call_recordings.duration_sec` over completed transcripts. Same reasoning as §5.4:
  a stored counter drifts, and one that drifts upward silences the alert exactly when a
  retry loop is burning money. Alert threshold 50h against a ~40h expected ceiling.
- **`raw_response` keeps the entire Sarvam payload, untrimmed.** Re-running extraction is
  ~₹0.03; re-running STT is ~₹0.75. Never discard a field and force the expensive path.
- **4xx is never retried**, 5xx and timeouts are retried 3× with exponential backoff. A
  4xx fails identically every time and each attempt is billable.
- **Recordings under 10s are skipped** with `status='failed'`, `error_text='too_short'`,
  and no API call — a misdial is not worth ₹0.75.
- `v_transcription_backlog` is the retry work list: recordings with no transcript, or one
  stuck `pending`/`processing`/`failed`.
- **The function runs on the service role, so RLS cannot constrain what it writes.** Its
  restraint (transcripts only) is enforced by review, not by the grant system — see the
  header of `tests/l2_transcribe.sql`. Making that a hard guarantee means moving it to a
  dedicated database role with explicit grants.

---

## 10. Where the schema differs from what you'd assume

Verified against the migrations. Do not go looking for things in this list — they aren't there.

- **Room double-booking IS prevented — by a trigger, not an `EXCLUDE` constraint.**
  There is no `btree_gist` and no exclusion constraint, but since `20260805140000`
  there *is* a date-range overlap guard: `app.guard_room_overlap()`, a
  `before insert or update` trigger raising `23514` when two **active** (unreleased)
  stays overlap on the same room, using `daterange(..., '[)')` so a checkout day and the
  next checkin day do not collide. A trigger was chosen deliberately over `EXCLUDE`
  because `room_assignments` uses soft-release and an `EXCLUDE` cannot be partial —
  released history would wrongly block new bookings. Verified by L1
  (`L1.4-room-overlap`, `L1.4-room-adjacent`).
  Alongside it: `app.guard_room_capacity()` counts active assignments and raises `23514`
  if occupancy would exceed `rooms.max_capacity` (the extra-bed ceiling; `capacity` is the
  base), bypassable with `is_override = true` plus a non-null `override_reason`. Plus a
  partial unique index `room_assignments_one_active_per_guest on (guest_id) where
  released_at is null`, so one guest cannot hold two active rooms.
  *(An earlier version of this section claimed no overlap guard existed at all and that
  date ranges were ignored. Both were wrong.)*
- **There is no "disputed proof" mechanism.** `delivery_proofs` has no `disputed` column and
  no admin flow to mark one. The row is genuinely immutable. Building this means a new
  sibling table — do not add a column to `delivery_proofs`.
- **There are no `desk` or `hamper` roles.** `app.event_role` is exactly
  `('event_team', 'client')`. A finer field-staff split needs an enum value plus new RLS, and
  every existing `app.is_staff()` call would need revisiting.
- **There is no `admin_users` table.** Admin identity is `profiles.global_role = 'admin'`.
  The admin-related tables that *do* exist are `admin_devices`, `event_access_codes`,
  `code_reveal_log` and `login_attempt_log`. Likewise the extraction table is
  `rsvp_extractions`, not `extractions`.
- **Revoking or rotating an access code now ends live sessions** (`20260809140000`).
  Before it, `verifyCodeAuthToken` checked signature and expiry only and RLS read claims
  straight from the JWT, so a revoked code left a phone with full read *and write* access
  until the token expired — confirmed against the live project, 30-day tokens. Enforcement
  is `app.code_is_live()`, folded into `app.is_staff()` / `app.is_member()` so PostgREST is
  covered too, plus `public.session_code_live()` for the app layer. `app.rotate_access_code`
  now retires the old row and inserts a replacement (it used to stamp `rotated_at` and then
  null it on the same row, marking nothing). Session lifetime is **7 days**, not 30.
  Uniqueness is a partial index over live codes only, so retired rows persist —
  they must, or a retired session could not be recognised.
- **Audit trigger coverage is not universal.** Attached to: `events`, `profiles`,
  `event_members`, `guest_groups`, `guests`, `travel_legs`, `call_attempts`,
  `call_recordings`, `rsvp_extractions`, `hotels`, `rooms`, `room_assignments`,
  `deliverables`, `vehicle_types`, `vehicles`, `trips`, `message_templates`, and
  `delivery_proofs` (insert only). **Missing on:** `transcripts`, `trip_passengers`,
  `messages`, `import_batches`, `import_rows`.
- **`apply_rsvp_extraction()` updates only the oldest leg per direction** — it selects
  `order by created_at limit 1`. A group with two arrival legs will never see the second one
  updated through the RPC.
- **`apply_rsvp_extraction()` blocks re-applying `accepted` only.** A `rejected` or
  `superseded` extraction can still be applied.
- **`rooms` is `unique (hotel_id, room_number)`**, not `(event_id, hotel_id, room_number)` —
  safe, because `hotel_id` is already event-fenced.
- **`guests` allows at most one head per group** via `guests_single_head_per_group on
  (group_id) where is_head`.
- **`deliverables_one_per_group_kind`** is `on (group_id, kind) where guest_id is null` —
  group-level hampers are unique per kind, per-guest ones are not constrained.
- **`trips.seats_used` is maintained by trigger** (`app.recount_trip_seats()`). Never write
  it from application code.
- **Storage buckets `call-recordings` and `delivery-proofs` are created by migration 0500**,
  both private, with select + insert policies only. No update, no delete, deliberately.

---

## 11. Current status (as of 31 July 2026)

**Done**
- `p1a` — Database schema, RLS, audit triggers. 7 migrations, ~1,663 lines, applied clean on
  Postgres 16. Schema covers **all 19 SRS sections**, not just Phase 1 — `event_id` was put
  everywhere up front deliberately, because retrofitting tenancy in week three kills deadlines.
- `p1b` — `test_security.sql`, 8 tests passing: cross-event insert blocked, client sees
  nothing in base tables, phone claiming 2020 gets stamped with real server time, room
  capacity guard fires, two callers can't lock the same group.

Both were verified against a Postgres 16 instance. **Neither has been applied to the live
Nuvent project**, which runs Postgres 17 — re-run `test_security.sql` there after the
first `db push`.

**Next up**
- `p1c` — **Excel import from `CALLING_MASTER_LIST.xlsx`.** Column mapper, mobile
  normalisation (+91 → last 10), idempotent by row hash. This is the line that turns an
  empty database into 238 real families.
- Then: `p1d` auth/event switching/role routing → `p1e` calling queue → `p1f` call screen →
  `p1g` native call-recording module → `p1h` upload/transcribe/extract → `p1i` review screen →
  `p1j` Excel export.

**Later phases:** 2 Rooms · 3 Hampers & return gifts · 4 Logistics & departure ·
5 Ship (WhatsApp, admin dashboard, APK, dry run, training).

---

## 11a. Static export — v2 scope, and why it is not a config flip

`output: 'export'` is set and the app compiles. It cannot finish, and the blocker is
structural rather than a matter of remaining effort.

**The real requirement: convert every nested dynamic segment to a query param.**
Twelve segments, `[groupId]`, `[hotelId]`, `[roomId]`, `[deliverableId]`,
`[extractionId]`, spanning the call screen, RSVP detail, review screen, hotel detail,
room edit and delivery detail. None of these are optional screens.

**Why the error message misleads.** `next/dist/build/index.js:1362`:

```js
const hasGenerateStaticParams = workerResult.prerenderedRoutes && workerResult.prerenderedRoutes.length > 0
if (config.output === 'export' && isDynamic && !hasGenerateStaticParams) throw ...
  // "Page X is missing generateStaticParams() ..."
```

It does not test whether the export exists. It tests whether the page **produced at
least one route**. A `generateStaticParams` that returns `[]` is present and still
fatal. Two things follow, both of which cost a session to learn:

- A codemod flipping `return [{}]` → `return []` (see `scripts/m2-fix-brackets.mjs` in
  `803104a`) swaps one zero-route form for another. Both throw. It cannot work.
- The page named in the error **varies between runs** — 15 parallel workers, first
  thrower wins. Do not chase the named page; it is not special.

**Baking row ids into `generateStaticParams` is REJECTED.** It "works" on the build
machine and fails in the field: any guest group, hotel, room, deliverable or extraction
created after the build has no prebuilt route, so the screen is unreachable on every
handset until the next APK ships. An event where staff add rows all day would be
generating dead links continuously. Querying Supabase at build time also bakes real row
ids into an artifact anyone can unzip.

Also still open if this is picked up again: 58 per-page `return []` stubs override the
layout above them and must be deleted rather than edited, and
`(admin)/admin/events/[eventCode]/` has no layout at all.

---

## 11b. The event build, and the event-day checklist

**The event build is the remote shell.** Verified 12 August 2026:

```
path      C:\android-builds\nuvent\debug\outputs\apk\release\app-release.apk
copy      C:\android-builds\nuvent\nuvent-2.0-release.apk   (identical)
size      6,551,504 bytes
sha256    357586be5547f47aaae0296705feaf3dfe0ab5dd7f991b0d64b15112198d20b3
version   versionCode 2 / versionName 2.0   (read from the APK, not the source)
signer    CN=Nuvent, O=Varunya Technologies   SHA-256 e865d4c1b3865da6…
baked url https://nuvent-five.vercel.app     (read from assets/capacitor.config.json
                                              INSIDE the apk; exact, 30 chars, no
                                              trailing space or slash)
```

Note the path: `android/app/build.gradle` sets `buildDir = "C:/android-builds/nuvent/debug"`
to escape OneDrive's file locks, so **nothing is ever written to
`android/app/build/outputs/`** despite what every Android tutorial says.

**What remote shell means on the day.** The WebView fetches the entire app from Vercel
at launch. There is no bundled copy. Network is a hard dependency, not a degradation —
this is the cost of deferring static export (§11a) and it is the thing the checklist
below exists to manage.

### Event-day checklist

- [ ] **Launch the app on every handset, on known-good Wi-Fi, before leaving for the
      venue.** First launch is when the WebView pulls and caches the JS bundle, and when
      each staff member's session is established. Doing that for the first time on venue
      Wi-Fi means doing the single most network-hungry step of the day at the worst
      moment available. Confirm each phone reaches a real screen, not the splash.
- [ ] **Mobile data enabled on every handset**, as the fallback path. Venue Wi-Fi is the
      documented single point of failure (§3) and in remote-shell mode there is nothing
      local to fall back to. A phone with mobile data off has no second route.
- [ ] **Do not force-close the app during the event.** Backgrounding is fine and expected
      — `tel:` backgrounds the WebView on every call. Force-closing is not: it discards
      `sessionStorage`, which holds the in-flight `call_attempts` id that the resume-first
      dial flow rehydrates on return (§12). Kill the app mid-call and that row never gets
      its `outcome`, so the attempt stays open forever — and per §5.4 the row is
      append-only, so it cannot be tidied up afterwards. It also forces a full re-fetch
      from Vercel on the next launch.

---

## 11c. The parked static-export branch — `feat/m2-static-export-bundle`

**Parked branch, NOT merged. Do not merge it without first re-deciding the static export
question in §11a.** Static export was deferred to v2 on **12 August 2026**; the event build
is the remote shell (§11b). Do not resume this branch before the event.

The branch is pushed, so it is recoverable — these are the only two SHAs recording that
work, and they are written down nowhere else:

| | |
|---|---|
| `803104a` | savepoint: uncommitted work from a concurrent session, committed unreviewed |
| `10ffd94` | trailingSlash, bundled androidScheme, pinned event params, raw hotel insert error |

Both subjects carry a stray leading `@` (PowerShell here-string syntax used in bash).
**This is DELIBERATE — DO NOT FIX.** Left as-is because the branch is a pushed
recoverability anchor, and rewriting published history to correct a cosmetic defect is a
worse trade than the defect. A future session that "tidies" these subjects is undoing a
decision, not fixing a typo.

Note on provenance: on the branch this text was a `**Stopped — static export deferred to
v2**` block inside its own §11, positioned within a status list (`P1`, `P3`, `P1G/P1H`
bullets) that master's §11 does not carry. It is a standalone section here so it depends on
no anchor outside itself; nothing was dropped in the move.

---

## 12. Known traps (learned the hard way — do not rediscover these)

- **Storage paths must start with the event id.** Bucket policies read the first folder
  segment as the tenant key and cast it to uuid:
  `delivery-proofs/{event_id}/{deliverable_id}/{uuid}.jpg`,
  `call-recordings/{event_id}/{group_id}/{uuid}.m4a`. Wrong path → rejected upload.
- **Excel import must create a `guests` row for the family head**, not just a `guest_groups`
  row. `client_guest_profiles` reads from `guests`; heads-only groups render blank.
- **`tel:` backgrounds the browser and Android may discard page state.** Write the
  `call_attempts` row with `started_at` **before** the dial fires, keep the id in
  `sessionStorage`, rehydrate on resume. The flow is *resume-first*, not *continue-first*.
  Remember the row freezes once `outcome` is set — write it once, at the end.
- **Real Excel is messy:** merged family rows, `"4th"` vs `"4TH"`, mobile numbers stored as
  decimals, `"Not Coming"` / `"Not Sure"` buried in a remarks column, blank rows. Import
  must show a **preview with a warning list** before it writes anything.
- **No browser can record a live phone call.** OS-level restriction, not a coding problem.
  It is why the native Capacitor module exists.
- **`delivery_proofs` insert requires `captured_by = auth.uid()`** in the RLS check. Setting
  it to anyone else fails, even for an admin.
- **A browser tab is not the app, and it silently fakes being one.** Opening the LAN URL in
  Chrome (or `am start -a VIEW -d <url>`) looks like the product but has no native bridge.
  Always launch via `npm run mobile:dev`. See "Running it on a phone" above.
- **`window.Capacitor` exists in the browser too.** `@capacitor/core` installs the global
  everywhere, so `Boolean(window.Capacitor)` is NOT a native check — it was true in Chrome and
  five call sites branched on it. Use `isNativePlatform()` from `src/lib/native/platform.ts`
  (wraps `Capacitor.isNativePlatform()`).
- **Never fire `tel:` from `window.open()`.** Two reasons: `'_system'` is a Cordova target that
  Capacitor 8 does not implement, and the dial happens *after* `await startCallAttempt(...)`,
  which expires the transient user activation — so the browser blocks it as a popup. **A blocked
  popup returns `null`, it does not throw**, so a `try/catch` fallback never runs and the tap
  silently does nothing. Go through `openExternalUrl()` in `src/lib/native/navigation.ts`
  (AppLauncher on native, `location.href` on web).
- **`<queries>` is required for `tel:` on API 30+.** This app targets 36. Without the
  `<queries>` block in `AndroidManifest.xml`, `resolveActivity()` returns null even though a
  dialer is installed, and the dial fails with nothing in logcat.
- **`allowNavigation` is an allowlist of hosts the WebView MAY navigate to itself** — it is not
  a way to mark URLs as "hand to the OS". It once listed `tel:*`/`mailto:*` with a comment
  claiming the opposite. It IS how you stop the LAN dev URL from opening in the system browser
  when `androidScheme` is `https` and `server.url` is `http`.
- **`set VAR=value ` in cmd.exe keeps the trailing space.** `CAP_SERVER_URL` was baked into
  `capacitor.config.json` as `"http://192.168.29.44:3000 "`. Capacitor `Uri.parse()`s it
  unmodified. The config now `.trim()`s; do not remove that.
- **npm scripts run through cmd.exe on Windows, where `&` is sequential, not backgrounding.**
  `"next dev & npx cap run android"` started the server and never launched anything. Use a
  Node script (`scripts/mobile-dev.mjs`), not shell backgrounding.

---

## 13. Open questions

1. **Call recording on Android 13+ is untested.** Restricted on many devices. This is the
   only open item that can change the *shape* of Phase 1 rather than just its schedule.
   Twenty minutes on one real team phone settles it. Everything else was deliberately built
   not to depend on the answer.
2. **Bus luggage-adjusted capacity unconfirmed.** Sticker sizes are 34 and 56; seeded 30 and
   50 as guesses. Needs the real numbers before the first dispatch.

---

## 14. Working rules for Claude Code sessions

- Start each session by pasting the current task's goal and its **definition of done**.
- End each session by committing to Git **and testing on a real Android phone**, not the
  laptop browser.
- Record every non-obvious decision in `DECISIONS.md` as it is made.
- If a task isn't finished, **simplify it on the spot** rather than borrowing from the next one.
- Mobile-first always: base font 16px, tap targets ≥44px, sticky header, works on a cheap
  Android phone on bad venue Wi-Fi.
- After feature freeze, the answer to every "can we also add…" is "after the event."

---

## 15. Scope cuts, in order, if time runs short

1. Departure dashboard
2. Excel export
3. WhatsApp templates beyond three (RSVP request, room + arrival confirmation, logistics detail)
4. Dashboard counters beyond eight
5. Vehicle *recommendation* (vehicle *assignment* is a must-have)

**Never cut:** import preview · check-in · hamper photo proof · realtime sync · the review screen.
