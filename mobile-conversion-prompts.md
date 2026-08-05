# Event Ops — Mobile Conversion Prompts (M1–M11)

Paste-ready Claude Code prompts for converting the Next.js 15 web app into a sideloaded Android APK.
Continues the A–K build-prompt series. Deadline: **26 Aug 2026**.

---

## Sequence & gates

| # | Prompt | Depends on | Est. | Blocking? |
|---|---|---|---|---|
| M1 | Static export audit (read-only) | — | 1h | **YES — decides M2 vs M2-ALT** |
| M2 | Static export conversion | M1 | 1–2 days | YES |
| M2-ALT | Remote-shell fallback | M1 (if M2 too costly) | 3h | — |
| M3 | Capacitor scaffold + Android project | M2 or M2-ALT | 3h | YES |
| M4 | Supabase auth persistence + deep links | M3 | 4h | YES |
| M5 | Live-reload loop + Sentry + debug harness | M3 | 3h | YES — do before M6+ |
| M6 | Native dialer + call-state plugin | M5 | 1 day | — |
| M7 | Call recording spike | **Hardware test first** | 1 day | Gated |
| M8 | Native camera + tamper-evident photo proof | M5 | 1 day | **Never-cut feature** |
| M9 | Offline hardening (Dexie + network state) | M5 | 1 day | **Never-cut feature** |
| M10 | Signed release build + distribution | M4, M8 | 4h | YES |
| M11 | OTA hotfix channel | M10 | 4h | Strongly recommended |

**Hard rule:** run M5 before M6–M9. Without live reload you rebuild an APK per change and lose a week.

---

## M1 — Static Export Audit (READ-ONLY)

```
Read CLAUDE.md at the repo root first for project context.

TASK: Audit this Next.js 15 App Router codebase for compatibility with `output: 'export'`
(static HTML export). This is a READ-ONLY audit. Do NOT change any files.

We are wrapping this app in Capacitor to ship an Android APK. Capacitor serves a static
folder of HTML/JS from the device — there is no Node server at runtime. Anything requiring
a server must be removed or moved to a Supabase Edge Function.

Produce a report at /docs/static-export-audit.md with these sections:

1. BLOCKERS — every file that prevents static export. For each: file path, what it does,
   and the specific reason it blocks. Search for all of:
   - `app/**/route.ts` and `route.js` (API route handlers)
   - `'use server'` directives (server actions)
   - `middleware.ts` / `middleware.js` at any level
   - `cookies()`, `headers()`, `draftMode()` from `next/headers`
   - `revalidatePath`, `revalidateTag`, `unstable_cache`
   - `export const revalidate` / `dynamic = 'force-dynamic'` / `runtime = 'nodejs'`
   - `rewrites`, `redirects`, `headers` in next.config
   - `next/image` usage (needs `unoptimized: true`)
   - `useSearchParams()` without a wrapping `<Suspense>` boundary

2. DYNAMIC ROUTES — list every dynamic segment route (`[id]`, `[...slug]`, etc.).
   For each, state whether the parameter set is knowable at build time.
   Any route keyed on a database ID (guest, family, room, hamper) is NOT knowable and
   must be converted to a query-param route. Propose the exact conversion, e.g.
   `/guests/[id]` -> `/guests?id=<uuid>` with client-side data fetching.

3. MIGRATION PLAN — for each blocker, classify as one of:
   (a) DELETE — it's a redundant wrapper; RLS already enforces access, so the client can
       call Supabase directly
   (b) MOVE TO EDGE FUNCTION — it needs the service role key or a server secret
   (c) CONVERT TO CLIENT — it can run in the browser as-is
   Give a one-line justification per item. Do not assume — read the actual file.

4. EFFORT ESTIMATE — total blockers, and a rough hours estimate for full conversion.

5. VERDICT — one of:
   - "CLEAN" (0–3 trivial blockers)
   - "MODERATE" (4–15 blockers, all mechanical)
   - "HEAVY" (>15 blockers, or server secrets threaded through many components)

Note anything using the Supabase SERVICE ROLE key with special prominence — that key
must never reach the client bundle.

DEFINITION OF DONE: /docs/static-export-audit.md exists, every blocker has a file path and
a classification, and the verdict line is present. No source files modified.
```

**Decision point:** CLEAN or MODERATE → run M2. HEAVY → run M2-ALT and revisit static export after the wedding.

---

## M2 — Static Export Conversion

```
Read CLAUDE.md and /docs/static-export-audit.md first.

TASK: Execute the migration plan in the audit. Convert this app to build as a static export.

STACK: Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, Supabase (Postgres 16,
Auth, Storage, Edge Functions, Realtime), TanStack Query, Dexie, react-hook-form + Zod.

RULES:
1. Work through blockers in the audit's order. After each blocker, run `npm run build`
   and confirm the error count went DOWN. Do not batch fixes blindly.
2. API routes classified DELETE: remove the route, and replace every caller with a direct
   `supabase.from(...)` client call. RLS is our security boundary — verify the equivalent
   RLS policy exists before deleting. If no policy covers it, STOP and tell me.
3. API routes classified MOVE TO EDGE FUNCTION: create the function under
   `supabase/functions/<name>/index.ts`, port the logic, and replace callers with
   `supabase.functions.invoke()`. The service role key stays server-side only.
4. Dynamic routes: convert to query params exactly as the audit proposed. Update every
   `<Link href>`, `router.push()`, and `redirect()` that targets them. Grep for hardcoded
   path strings — do not miss any.
5. Wrap every `useSearchParams()` consumer in a `<Suspense fallback={...}>` boundary.
6. next.config.js gets:
     output: 'export',
     images: { unoptimized: true },
     trailingSlash: true
   (`trailingSlash: true` matters — Capacitor's file server resolves directory URLs poorly
   without it.)

CONSTRAINTS:
- Do NOT change any database schema, migration file, or RLS policy.
- Do NOT change business logic. This is a transport-layer refactor only.
- Do NOT introduce new dependencies without telling me why.
- If a blocker cannot be resolved without a design change, STOP and explain the options.
  Do not invent a workaround silently.

DEFINITION OF DONE:
- `npm run build` completes with zero errors and produces an `out/` directory
- `out/index.html` exists and `out/` contains a directory per route
- `npx serve out` runs and the app loads, logs in, and lists guests
- No occurrence of the service role key anywhere under `out/` (grep to prove it)
- Report which routes moved to Edge Functions and which were deleted
```

---

## M2-ALT — Remote Shell Fallback

Use only if M1 returns HEAVY. Ships in hours, but the app requires connectivity — venue wifi becomes a single point of failure.

```
Read CLAUDE.md first.

TASK: Set up Capacitor as a native shell over the deployed Vercel URL, rather than a
static bundle. We are short on time and the static export conversion is too expensive.

STEPS:
1. Install: @capacitor/core @capacitor/cli @capacitor/android
2. `npx cap init "Event Ops" com.eventops.app`
3. capacitor.config.ts:
     webDir: 'public'        // placeholder, unused in this mode
     server: {
       url: 'https://<OUR_VERCEL_URL>',
       cleartext: false,
       androidScheme: 'https'
     }
4. `npx cap add android && npx cap sync`
5. Add a hard-coded offline splash screen in the Android project that appears when the
   remote URL is unreachable, with a "Retry" button. Do not let users see a blank WebView.
6. Add @capacitor/network and surface a persistent banner when offline.

IMPORTANT: Native plugins (camera, phone state) still work in this mode — the WebView is
still native. Only the HTML/JS is remote.

DEFINITION OF DONE: APK installs, loads the live site, camera plugin callable from the
WebView, offline splash appears when airplane mode is on. Document in CLAUDE.md that we
are in REMOTE SHELL mode and that offline support is NOT available.
```

---

## M3 — Capacitor Scaffold + Android Project

```
Read CLAUDE.md first.

TASK: Add Capacitor and generate the Android project.

STEPS:
1. Install: @capacitor/core @capacitor/cli @capacitor/android
   Plus: @capacitor/preferences @capacitor/network @capacitor/camera
         @capacitor/filesystem @capacitor/app @capacitor/status-bar @capacitor/splash-screen
2. `npx cap init "Event Ops" com.eventops.app --web-dir=out`
3. capacitor.config.ts:
     appId: 'com.eventops.app'
     appName: 'Event Ops'
     webDir: 'out'
     android: { allowMixedContent: false }
     server: { androidScheme: 'https' }
   (androidScheme 'https' is required — the 'capacitor://' scheme breaks localStorage
   origin matching and Supabase auth persistence.)
4. `npx cap add android`
5. In android/app/build.gradle: minSdkVersion 23, targetSdkVersion 35, compileSdkVersion 35.
   Set versionCode 1, versionName "1.0.0".
6. Add an npm script: "mobile": "next build && npx cap sync android"
7. Hardware back button: register an `App.addListener('backButton', ...)` handler in the
   root layout. Default behavior closes the app from any screen — instead, navigate back
   through history and only exit when at the root route. Show a "press back again to exit"
   toast on the root.
8. Safe areas: add CSS `env(safe-area-inset-*)` padding to the app shell so content clears
   the status bar and gesture nav bar. Configure StatusBar plugin for a dark-content
   style matching our theme.
9. Add `android/` build artifacts to .gitignore but COMMIT the `android/` project itself —
   we hand-edit the manifest and gradle files later.

DEFINITION OF DONE:
- `npm run mobile` succeeds
- `npx cap open android` opens Android Studio with no gradle sync errors
- Debug APK builds and installs on a handset
- App launches, shows the login screen, status bar does not overlap content
- Hardware back navigates instead of killing the app
```

---

## M4 — Auth Persistence + Deep Links

```
Read CLAUDE.md first.

TASK: Make Supabase auth survive app restarts inside the Android WebView.

PROBLEM: The default localStorage adapter works in the WebView but is cleared when Android
reclaims WebView storage or the user clears app cache. Staff would be logged out mid-event.

STEPS:
1. Write a Capacitor Preferences storage adapter implementing the Supabase
   `SupportedStorage` interface (getItem / setItem / removeItem, all async).
   Preferences maps to Android SharedPreferences — it survives cache clears.
2. Wire it into the Supabase client:
     createClient(url, anonKey, {
       auth: {
         storage: capacitorStorageAdapter,
         persistSession: true,
         autoRefreshToken: true,
         detectSessionInUrl: false,   // native: no URL fragment to parse
         flowType: 'pkce'
       }
     })
3. The client must be created ONCE as a singleton module export. Confirm we are not
   instantiating it per-component — that causes duplicate refresh-token races.
4. Token refresh on resume: add an `App.addListener('appStateChange', ...)` that calls
   `supabase.auth.refreshSession()` when the app returns to foreground after being
   backgrounded. Android suspends timers, so the auto-refresh interval will have stalled.
5. AUTH METHOD CHECK: tell me whether we currently use magic links or email+password.
   - If email+password: no deep-link work needed. Confirm and stop here.
   - If magic links: register a custom URL scheme in AndroidManifest.xml as an
     intent-filter, add `App.addListener('appUrlOpen', ...)` to catch the callback, and
     call `supabase.auth.exchangeCodeForSession()` with the code param. Without this the
     login link opens Chrome and dead-ends.
6. Add a session-expired interceptor: on any 401 from Supabase, route to login rather than
   showing a broken screen.

DEFINITION OF DONE:
- Log in, force-stop the app, reopen -> still logged in
- Log in, clear app cache (not data) from Android settings, reopen -> still logged in
- Background the app for 2+ hours, reopen -> session refreshes, no 401s
- Only one Supabase client instance exists (grep to prove it)
```

---

## M5 — Live Reload + Sentry + Debug Harness

**Run this before M6–M9.** It is the difference between a one-week and a three-week build.

```
Read CLAUDE.md first.

TASK: Set up the on-device debugging loop. Without this, every code change requires a full
APK rebuild and reinstall.

PART A — LIVE RELOAD
1. Create capacitor.config.dev.ts that extends the base config with:
     server: { url: 'http://<LAN_IP>:3000', cleartext: true }
   Read the LAN IP from an env var (CAP_DEV_HOST) — do not hardcode it, it changes.
2. Add npm scripts:
     "mobile:dev": run next dev + copy dev config + npx cap run android --livereload
     "mobile:prod": restore base config + next build + cap sync
3. Add `android:usesCleartextTraffic="true"` to the DEBUG manifest variant ONLY
   (android/app/src/debug/AndroidManifest.xml). It must NOT be in the release manifest.
4. Document the exact command sequence in CLAUDE.md under a "Mobile dev loop" heading,
   including how to find the LAN IP on macOS/Windows/Linux.

PART B — SENTRY
5. Install @sentry/capacitor and @sentry/react. Initialize in the app root with:
   - dsn from env
   - environment tag: 'dev' | 'staging' | 'production'
   - release tag matching versionName
   - a user context set to the logged-in staff member's id and role after auth
   - a tag for the current event_id (multi-tenant — we need to know which event broke)
6. Wrap the app in a Sentry ErrorBoundary that shows a recoverable "Something went wrong,
   tap to reload" screen rather than a white WebView.
7. Add breadcrumbs for: Supabase query failures, network state changes, camera capture
   attempts, call initiations. These are the four things that will break at the venue.

PART C — DEBUG UTILITIES
8. Build a hidden diagnostics screen at /debug (reachable by tapping the app version label
   5 times on the settings screen). It shows:
   - app version, versionCode, Capacitor version
   - Android version and device model
   - current user id, role, event_id
   - online/offline state and last successful sync timestamp
   - count of unsynced Dexie records
   - granted/denied status of every runtime permission
   - a "Send test error to Sentry" button
   - a "Copy diagnostics to clipboard" button
   This screen is how a staff member tells us what's wrong over WhatsApp during the event.

DEFINITION OF DONE:
- Edit a component, save, and see the change on the handset within ~2s without rebuilding
- chrome://inspect/#devices shows the WebView and DevTools console attaches
- `adb logcat | grep -iE "capacitor|chromium"` shows app logs
- A thrown test error appears in the Sentry dashboard with correct user + event tags
- /debug screen renders and the clipboard copy works
- Release manifest contains NO cleartext traffic permission (grep to prove it)
```

---

## M6 — Native Dialer + Call State

```
Read CLAUDE.md first. Reference SRS section 1 (RSVP Calling).

CONTEXT: The calling unit is the FAMILY HEAD, not individual guests. We must track call
count and outcome per family head. ~238 family groups to call.

TASK: Implement native calling with automatic call-state tracking. This is three separate
capabilities — build them in order and do not conflate them.

PART A — DIALING (works today, verify it)
1. Basic `tel:` navigation already works via the Capacitor WebView intent handler.
   Verify with an `<a href="tel:+919876543210">` and confirm the dialer opens.
2. If it does not, add the scheme to `allowNavigation` in capacitor.config.ts.

PART B — DIRECT DIAL (skips the dialer confirmation screen)
3. Write a custom Capacitor plugin `CallPlugin` in Kotlin under
   android/app/src/main/java/com/eventops/app/:
   - method `dial(phoneNumber: String)` using Intent.ACTION_CALL
   - requires CALL_PHONE permission in AndroidManifest.xml
   - request the permission at runtime with a clear rationale dialog before first use
   - fall back to ACTION_DIAL (the confirm screen) if permission is denied — never fail
     silently, the staff member still needs to make the call
   We sideload the APK, so the Play Store restricted-permission policy does not apply.

PART C — CALL STATE (this is what makes tracking automatic)
4. Extend CallPlugin with call-state listening:
   - Android 12+ (API 31+): TelephonyManager.registerTelephonyCallback with
     TelephonyCallback.CallStateListener
   - Android 11 and below: PhoneStateListener (deprecated but required for older handsets)
   - Detect and report the IDLE -> OFFHOOK -> IDLE transition
   - Requires READ_PHONE_STATE, requested at runtime
5. Emit Capacitor events to the WebView: 'callStarted', 'callEnded' with duration in
   seconds computed from the OFFHOOK->IDLE window.
6. Distinguish a connected call from an unanswered one: if the state goes RINGING -> IDLE
   without OFFHOOK, or OFFHOOK duration is under 5 seconds, mark the outcome as
   'not_connected' rather than 'connected'.

PART D — UI WIRING
7. On the call screen for a family head: tapping call fires the plugin, and on 'callEnded'
   automatically:
   - increments call_count for that family head
   - writes a call_attempt row with duration, outcome, staff user id, and a
     SERVER-STAMPED timestamp (use the database default, never the device clock)
   - opens the RSVP outcome form pre-focused, so the staff member logs the result while
     it is fresh
8. If the app was backgrounded during the call (it will be), ensure the resume handler
   restores the correct family head context and shows the outcome form immediately.

CONSTRAINTS:
- Do NOT request READ_CALL_LOG. We do not need it, and it is a restricted permission that
  triggers extra scrutiny and user alarm.
- All timestamps come from the database, per our insert-only proof principle.
- Handle permission denial gracefully at every step. A staff member with denied permissions
  must still be able to dial manually and log outcomes by hand.

DEFINITION OF DONE:
- Tapping call on a family head dials directly without a confirm screen
- Ending the call auto-increments call_count and opens the outcome form
- An unanswered call is recorded as 'not_connected', not 'connected'
- Denying CALL_PHONE falls back to the system dialer and the app still works
- Tested on a real handset, not an emulator (emulators do not have telephony)
```

---

## M7 — Call Recording Spike

**GATE: Do not run this prompt until the 20-minute hardware test is complete on the actual team handset model.** Android 10+ removed the `VOICE_CALL` audio source for third-party apps; Android 13/14 may capture nothing usable. Test first, build second.

```
Read CLAUDE.md first.

CONTEXT: We tested call recording on a real <MODEL> running Android <VERSION>.
Result: <PASTE THE ACTUAL TEST RESULT HERE>

TASK: Build the call recording capability IF AND ONLY IF the test above passed. If the
test showed the remote party's audio is not captured, STOP and tell me — we switch to the
manual-notes design instead.

IF THE TEST PASSED:
1. Write a `RecorderPlugin` in Kotlin:
   - MediaRecorder with AudioSource.MIC (NOT VOICE_CALL — that source is blocked)
   - AAC encoding, 16kHz mono, ~32kbps — optimized for speech and small file size
   - writes to app-private storage via Filesystem, never to shared media storage
   - RECORD_AUDIO permission requested at runtime with a clear rationale
2. The flow is: staff taps call -> app enables speakerphone via AudioManager -> starts
   recording -> call proceeds -> call ends (detected by M6's call-state listener) ->
   recording stops automatically. The staff member should never tap "record."
3. On stop: upload the audio to Supabase Storage under a path keyed by event_id and
   family_head_id. Write a recording row with a server-stamped timestamp.
4. Wire the existing STT -> Claude extraction pipeline: after upload, invoke the Edge
   Function that runs Sarvam/Google STT, then Claude extraction, then writes a DRAFT
   extraction row. It must NOT write to the guest tables directly.
5. The extraction surfaces in the human review screen. Nothing enters the guest data
   without explicit human sign-off. AI extraction is evidence, not truth.
6. Storage budget: at ~32kbps, a 5-minute call is ~1.2MB. 238 family heads x maybe 2 calls
   = ~570MB. Confirm this fits our Supabase Storage plan before enabling for all staff.
7. Legal: add a one-time consent screen at first login stating that calls are recorded for
   event coordination. Staff acknowledge it. Add a spoken-disclosure line to the calling
   script for the guest side.

IF THE TEST FAILED:
Design the fallback instead: a notes field on the call screen with large tap targets and
optional voice-note dictation (recording the STAFF MEMBER's summary after the call ends,
not the call itself). Same STT -> Claude -> human review pipeline, different input source.
This is a genuinely fine outcome — do not treat it as a degraded build.

DEFINITION OF DONE:
- A test call produces an audio file where BOTH parties are audible
- The file uploads and a draft extraction appears in the review screen
- No extraction writes to guest tables without human approval
- Consent screen shown once and acknowledgment recorded
```

---

## M8 — Native Camera + Tamper-Evident Photo Proof

Never-cuttable feature. Do not defer.

```
Read CLAUDE.md first. Reference SRS sections 11–13 (Hamper and Return Gift Management).

TASK: Replace any web `<input type="file">` photo capture with the native Capacitor Camera
plugin, and enforce the tamper-evident proof chain.

REQUIREMENTS:
1. Use @capacitor/camera with:
     source: CameraSource.Camera        // NOT Prompt, NOT Photos
     allowEditing: false
     quality: 70
     resultType: CameraResultType.Uri
   CameraSource.Camera is non-negotiable: allowing gallery selection breaks the proof
   chain entirely, because a staff member could submit any photo.
2. Request CAMERA permission at runtime with a rationale. Denial must block delivery
   confirmation — there is no photo-less path to marking a hamper delivered.
3. Compression: resize the longest edge to 1600px client-side before upload. At a venue
   on mobile data, a 6MB photo will not upload. Target under 400KB per photo.
4. Upload to Supabase Storage under a path keyed by event_id / deliverable_id.
   Then insert the proof row. The proof row:
   - is INSERT-ONLY (verify the RLS policy denies UPDATE and DELETE to all roles)
   - takes its timestamp from the DATABASE DEFAULT, never from the device
   - records the storage path, the delivering staff user id, and the deliverable id
5. Do NOT read or trust EXIF timestamps from the photo. Device clocks are not trustworthy.
   Strip EXIF before upload — it also removes GPS data we have no reason to retain.
6. OFFLINE PATH: if the upload fails, queue the photo in Dexie with the pending proof row
   and retry on reconnect. The staff member must see "queued, will sync" — never a silent
   failure and never a false "delivered" state. The delivery is not confirmed until the
   proof row is committed server-side.
7. UI: after capture, show a confirmation preview with the guest name, room number, and
   deliverable type overlaid, plus explicit Confirm / Retake buttons. A staff member
   walking a hotel corridor must be able to see they are at the right room before
   committing.
8. Show a persistent count of unsynced proofs in the app header when > 0.

CONSTRAINTS:
- Do NOT allow gallery picking under any circumstance, including as a fallback.
- Do NOT mark a deliverable delivered until the server confirms the proof insert.
- Do NOT modify existing RLS policies — verify them and report if any are wrong.

DEFINITION OF DONE:
- Capture opens the native camera directly, no source-choice prompt
- Gallery access is impossible from this flow
- An attempt to UPDATE or DELETE a proof row is rejected by RLS (write a test proving it)
- Proof timestamp comes from the database, verified by setting the device clock forward
  1 year and confirming the stored timestamp is still correct
- Airplane-mode capture queues, shows "queued", and syncs on reconnect
- Photos upload in under 5s on a 4G connection
```

---

## M9 — Offline Hardening

Never-cuttable feature. Venue wifi will fail.

```
Read CLAUDE.md first.

CONTEXT: ~465 guests, ~238 family groups, 15ish staff handsets, an Indian wedding venue
with unreliable connectivity. The app must remain usable with no network.

TASK: Harden the TanStack Query + Dexie offline layer for the native WebView.

PART A — CONNECTIVITY
1. Add @capacitor/network. Wire the online/offline state into a global store.
2. Persistent, non-dismissible header banner when offline showing "Offline — N changes
   queued". It must be impossible to miss.
3. TanStack Query: set networkMode: 'offlineFirst' and configure retry with exponential
   backoff capped at 30s. Do not let it hammer a dead connection and drain batteries.

PART B — READ CACHE
4. Persist the TanStack Query cache to Dexie (not localStorage — the WebView may clear it).
   Cache these as read-critical: guest list, family heads, room allocations, deliverable
   assignments for the current event.
5. On login while online, warm the cache with a full pull of the current event's data.
   ~465 guests is small — pull it all rather than paginating. Show a progress indicator.
6. Every cached screen displays a "last synced HH:MM" line. Staff must know how stale
   their view is before acting on it.

PART C — WRITE QUEUE
7. Queue mutations in a Dexie table with: local id, operation type, payload, created_at
   (device clock, for ORDERING ONLY — never for the authoritative record), retry count,
   and last error.
8. Flush the queue on reconnect, in creation order. Each mutation goes to the server, which
   stamps the authoritative timestamp.
9. Idempotency: every queued mutation carries a client-generated UUID. The server upsert
   keys on it so a double-flush cannot create duplicates. This mirrors our idempotent
   Excel import principle.
10. CONFLICT HANDLING — the case that will actually happen: two staff members mark the
    same hamper delivered while both offline. Resolution: first write wins, second becomes
    a duplicate-attempt record that is visible in a review list rather than silently
    dropped. Never overwrite a committed proof.
11. Failed mutations after 5 retries move to a "needs attention" list on the /debug screen
    with the error text. They must never vanish.

PART D — REALTIME
12. Supabase Realtime subscriptions must tear down cleanly when the app backgrounds and
    re-establish on resume, then trigger a cache refetch. A stale WebSocket that appears
    connected but delivers nothing is worse than being visibly offline.

CONSTRAINTS:
- Never show a success state for an unsynced write. "Queued" and "Saved" are different words.
- Device clocks are for ordering only. All authoritative timestamps are server-side.

DEFINITION OF DONE:
- Airplane mode: guest list, rooms, and deliverables all still load from cache
- 10 mutations made offline all sync correctly on reconnect, in order
- Killing the app mid-queue and reopening resumes the flush without data loss
- Flushing the same queue twice creates zero duplicate rows (write a test)
- Two-device conflict test produces one committed record and one flagged duplicate
- Backgrounding for 10 minutes and resuming refreshes data without a manual pull
```

---

## M10 — Signed Release + Distribution

```
Read CLAUDE.md first.

TASK: Produce a signed release APK and a distribution process for ~15 staff handsets.

PART A — SIGNING
1. Generate a release keystore with keytool. RSA 2048, 10000 day validity.
2. Store the keystore OUTSIDE the repo. Add *.jks and *.keystore to .gitignore.
   Credentials go in android/keystore.properties, also gitignored.
   Write android/keystore.properties.example with placeholder values, and commit that.
3. Configure signingConfigs in android/app/build.gradle to read from keystore.properties.
   Build must fail loudly with a clear message if the file is missing — never fall back
   to debug signing for a release build.
4. LOSING THIS KEYSTORE MEANS EVERY STAFF MEMBER MUST UNINSTALL AND REINSTALL, LOSING
   QUEUED OFFLINE DATA. Back it up to two places today. Add this warning to CLAUDE.md.

PART B — RELEASE CONFIG
5. Release build: minifyEnabled true, shrinkResources true. Add ProGuard keep rules for
   Capacitor plugin classes and our custom CallPlugin/RecorderPlugin — reflection-based
   plugin registration breaks under R8 otherwise.
6. Verify the release manifest contains NO cleartext traffic permission and NO debuggable
   flag. Grep and prove it.
7. Upload the ProGuard mapping file to Sentry so release stack traces are readable.
8. Set versionCode and versionName from a single source. Add a script that bumps both.

PART C — DISTRIBUTION
9. Do NOT distribute the APK as a WhatsApp file attachment — it gets compressed, renamed,
   and staff end up on mismatched versions. Instead: upload to a Supabase Storage bucket
   with a public read policy and share the URL.
10. Build an install page (static HTML in the bucket) with:
    - the download button
    - the current version number, prominently
    - screenshots of the exact tap sequence to get past Play Protect's "unsafe app"
      warning on Android 13/14/15 — capture these from a real device
    - the permissions the app will request and a one-line reason for each
    - a WhatsApp link to you for help
11. In-app version check: on launch, fetch a version.json from the bucket. If the installed
    versionCode is behind, show a non-dismissible update prompt linking to the install page.

PART D — PRE-DISTRIBUTION CHECKLIST
12. Before sending to staff, verify on a clean handset:
    - installs without errors
    - login works
    - camera capture works
    - dialing works
    - offline mode works
    - Sentry receives a test error tagged 'production'

DEFINITION OF DONE:
- Signed release APK builds reproducibly
- Keystore backed up in two locations, documented in CLAUDE.md
- Install page live with real Play Protect screenshots
- Clean-device install passes all six checklist items
- Sentry shows readable stack traces from the release build
```

---

## M11 — OTA Hotfix Channel

Strongly recommended. Without it, every bug fix during the event means 15 people reinstalling.

```
Read CLAUDE.md first.

TASK: Add over-the-air updates for the JS bundle so we can ship fixes during the event
without redistributing the APK.

1. Install @capgo/capacitor-updater (open source, self-hostable).
2. Point it at a Supabase Storage bucket rather than a third-party service — we already
   have the infrastructure and the data stays ours.
3. Build a release script that: builds the static export, zips `out/`, uploads it to the
   bucket with a version number, and updates a manifest.json.
4. Update policy: check for updates on app resume, download in the background, and apply
   on next app start. Do NOT hot-swap the bundle mid-session — a staff member halfway
   through a hamper delivery must not have the app reload under them.
5. Add a rollback path: keep the previous 2 bundles in the bucket, and put a "revert to
   previous version" control on the /debug screen. If a hotfix makes things worse at 9pm
   during a wedding, we need a 30-second undo.
6. LIMITATION — document this clearly in CLAUDE.md: OTA updates ship JS/HTML/CSS only.
   Any change to native code (CallPlugin, RecorderPlugin, permissions, AndroidManifest,
   gradle config, or a new Capacitor plugin) requires a full APK redistribution. Plan
   native changes to be finished before distribution day.
7. Add the current bundle version to the /debug diagnostics screen.

DEFINITION OF DONE:
- Push a JS-only change, and a handset picks it up on next launch without reinstalling
- Rollback control restores the previous bundle
- Bundle version visible on /debug
- Native-change limitation documented in CLAUDE.md
```

---

## Suggested schedule (22 days to 26 Aug)

| Days | Work |
|---|---|
| Aug 4 | M1 audit. **Run the 20-min call recording hardware test the same day** — it gates M7. |
| Aug 5–6 | M2 static conversion |
| Aug 7 | M3 + M4 |
| Aug 8 | M5 (debug harness) |
| Aug 9–10 | M8 camera proof — never-cuttable, do it early |
| Aug 11–12 | M9 offline — never-cuttable |
| Aug 13–14 | M6 calling |
| Aug 15 | M7 recording, or the fallback design |
| Aug 16–17 | M10 + M11, distribute to 2 test handsets |
| Aug 18–20 | Dry run with real staff on real handsets |
| Aug 21–23 | Fix what the dry run breaks |
| Aug 24 | Distribute to all handsets, staff training |
| Aug 25 | Buffer |
| Aug 26 | Event |

Buffer is thin. If the M1 audit returns HEAVY, take M2-ALT and reclaim two days rather than fighting the static export.

---

## Still open (unchanged from before, but now blocking mobile work)

- Bus luggage-adjusted capacities — placeholder values still seeded
- Hotel room list with capacities — blocks room allocation
- PAX vs. named-guests modeling — blocks Excel import
- Hampers and return gifts: one `deliverables` table or two — M8 assumes one; if you split, M8's proof schema changes
- WhatsApp BSP verification — external approval timeline, start today if not already running
