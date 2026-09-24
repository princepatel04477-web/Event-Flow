# EventFlow Interaction & Latency Contract

This document defines the checkable rules governing response time, perceived performance, and state feedback across EventFlow. 

EventFlow's UX rules (`docs/UX-RULES.md`, R1–R8) define visual hierarchy, plain vocabulary, touch targets, and failure recovery. They say nothing about time. Yet in the field, "it feels laggy" is the loudest operational complaint from wedding staff. This contract is the missing half. Every interaction is judged against it as checkable rules, not generic performance advice.

### The Operational Reality

EventFlow is a multi-tenant wedding operations platform deployed as a Capacitor remote shell (`M2-ALT`, `CLAUDE.md §11c`) running `com.nuvent.app` over `nuvent-five.vercel.app`. It is operated on cheap Android handsets (2GB RAM, Android Go, low single-core performance) by non-technical runners who receive zero training. The app ground is warm ivory (`#f8f9fa`) with deep charcoal text and gold accent (`src/app/globals.css`). There is no local static bundle; every network hop is felt. 

The edge enters at Mumbai (`bom1`), but the Next.js compute runtime and Supabase Postgres live in Seoul (`icn1` and `ap-northeast-2`, `CLAUDE.md §3`). Deployed S1 guest-list timings were measured at 7.4s and 9.9s against a 5s budget, with laptop TTFB swinging from 0.58s to 6.5s on venue Wi-Fi (`CLAUDE.md §3`). In a noisy banquet hall or corridor, an unacknowledged tap causes a second tap, duplicate actions, and data confusion. The rules below make the interface predictable and responsive under these constraints.

---

## The Seven Rules

### T1. The tap owns the first 100ms.

On low-end Android handsets running inside a Capacitor remote shell, any delay between physical touch and visual acknowledgement leads an untrained runner to assume the touch missed. In a chaotic hotel corridor or noisy banquet hall, an unacknowledged touch causes staff to tap again in frustration. That second tap fires duplicate server actions, starts competing network requests, or cancels in-flight operations. The interface must prove it registered the touch within 100ms, using local client state and CSS transitions only — never waiting for a network hop across ~6,000km to Seoul.

- **Pass condition:** No control's first visual response is behind an `await`.
- **Right:** `src/components/ui/Button.tsx` (lines 26–31) and `src/app/globals.css` (lines 124, 373–376), where every button applies the `.tap` utility (`touch-action: manipulation; -webkit-tap-highlight-color: transparent`) and transitions background on touch with `--ef-duration-press: 100ms` (`duration-press`) via `active:bg-brand-hover` or `active:bg-surface-2`. Alternatively, the PAX stepper buttons in `src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx` (lines 462–479), where clicking `PlusIcon` or `MinusIcon` updates local state (`values.adultsConfirmed`) and paints the updated number synchronously with zero network dependency.
- **Wrong:** `src/app/(staff)/[eventCode]/rsvp/unmatched/UnmatchedTrayClient.tsx` (lines 64–96, 188–195), where tapping "Retry auto-match" invokes `handleRetryMatch(entry.path)`, which sets no loading state, pending flag, or spinner on the button before calling `await matchRecording(...)` (line 73) and `await markMatched(...)` (line 82) — placing the control's first visual response directly behind network round trips. By contrast, `src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx` (lines 175–176) does not violate T1's first-response rule because `setSaving(true)` executes synchronously before `await saveRsvpLog(...)` (and the button has immediate CSS feedback via `duration-press`), but it illustrates the related delay where its first *meaningful layout change* (`SavedState` on line 252) remains gated behind `await saveRsvpLog(...)` (line 176) and `await releaseGroupAfterCall(...)` (line 204).

---

### T2. A write shows its result before the server confirms it.

Venue Wi-Fi in Indian wedding hotels is notoriously degraded and prone to dropping packets. When requests must cross the continent to Seoul (`icn1` and `ap-northeast-2`), waiting for server confirmation on reversible writes (such as logging RSVP status, changing PAX counts, or assigning a room) freezes the user interface for multiple seconds. Reversible writes must update local screen state and cache immediately, optimistic of success, and reconcile when the server returns. If the server rejects the write (such as a database constraint violation), the screen rolls back gracefully and displays an honest explanation (UX-RULES.md R5, R6). The only exception is sealing a delivery proof, which is permanently insert-only and immutable in the database schema (`CLAUDE.md §5.2`).

- **Pass condition:** No reversible write blocks the UI on a round trip. The exception is sealing a delivery proof (insert-only, `CLAUDE.md §5.2`) — that one waits, and says it is waiting.
- **Right:** Reversible writes (such as check-in toggles or guest room assignments), where the client updates local state immediately and surfaces a non-blocking undo bar (`src/components/ui/UndoBar.tsx` per `docs/UX-RULES.md` R5). In contrast, `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx` handles an irreversible write: inserting a photo proof into `delivery_proofs`, where unconditional `app.block_mutation()` triggers (`CLAUDE.md §5.2`) prevent any update or delete. The screen blocks on the server round trip via `<Button loading={phase.name === 'uploading'}>Confirm delivery</Button>` rather than optimistic completion, and explicitly warns the user on screen before submission ("Once confirmed, this proof cannot be changed or deleted — not even by an admin."). Once committed, it renders a sealed stamp (`@utility seal-in`) and a read-only metadata receipt.
- **Wrong:** Legacy v1 `src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx` (lines 164–183), where logging an RSVP outcome (a fully reversible update to `guest_groups.rsvp_status`) halted user interaction by setting `saving = true` and blocking behind `await saveRsvpLog(...)` before showing the saved outcome, instead of immediately applying the status locally. (The v2/v3 queue at `CallNext.tsx` replaces this with optimistic advancement).

---

### T3. A disabled button is a bug unless the input is invalid.

Toggling `loading={true}` on a button sets `disabled={disabled || loading}` (line 93), replaces `leadingIcon` with a `<Spinner>` (lines 98–100), and suppresses `trailingIcon` (line 104) while continuing to render `{children}` (the action label) unconditionally (`src/components/ui/Button.tsx` lines 93–105). On bad venue Wi-Fi with high packet drop, disabling the button during network operations strips away the runner's sole interactive control for the duration of the network timeout (often 10–30 seconds). If the user made a mistake, wants to edit notes, or wants to dismiss the view, they are completely paralyzed. A button may only be disabled when client-side form validation is unsatisfied (e.g. required inputs missing). For reversible writes, the button must remain responsive or transition immediately to the next screen.

- **Pass condition:** `<Button loading>` appears only on irreversible commits.
- **Right:** `src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx` line 378 disabling the submit button client-side when no status option is selected (`disabled={status === ''}`). For irreversible commits, `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx` uses `loading={phase.name === 'uploading'}` on the "Confirm delivery" button (line 365) where accidental duplicate submissions would violate the insert-only trigger constraint — though with the qualification that `DeliveryDetail.tsx` itself violates T3's pass condition elsewhere by setting `loading={phase.name === 'capturing'}` on the "Take photo" camera-capture button (line 331), which is not an irreversible commit.
- **Wrong:** Legacy v1 `src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx` lines 374–382: `<Button size="lg" fullWidth loading={saving} disabled={status === ''} onClick={handleSave}>Save outcome</Button>` (where line 377 sets `loading={saving}`), which disabled the button and spun during the network round trip for a routine, reversible RSVP status update.

---

### T4. Navigation is instant or it is not navigation.

In a remote-shell APK on cheap hardware, navigating to a new tab or tapping a family card must never dump the user onto a blank white canvas or a full-page loading spinner. Staff tap between tabs (Home, Rooms, Calls) dozens of times per hour. If a route transition displays `PageLoading` (`src/components/ui/PageLoading.tsx` lines 19–26) with a centered spinner, the application feels like a broken website rather than native software. The destination screen's structural frame—sticky header, page title, section tabs, and cached records—must paint within 100ms from memory. Only genuinely new or dynamic data may arrive later, streaming into pre-laid-out skeleton rows (`LoadingRows.tsx`) without jumping layout.

- **Pass condition:** No route transition shows a full-screen loading state for data the client already had.
- **Right:** `src/components/ui/LoadingRows.tsx` rendering skeleton rows inside an already-painted list layout (matching `ListRow` dimensions so elements do not jump when data arrives), or client-side caching where cached lists render immediately and revalidate in the background.
- **Wrong:** Using `src/components/ui/PageLoading.tsx` as a full-screen route loading fallback (such as `src/app/(staff)/[eventCode]/rsvp/call/[groupId]/loading.tsx` or `src/app/(staff)/[eventCode]/rsvp/review/[extractionId]/loading.tsx`), which unmounts the view and renders a `min-h-[50vh]` spinner while waiting for server round trips, even when the guest group name and previous status were already present in memory.

---

### T5. One tap is one round trip, at most.

With EventFlow deployed on Vercel Seoul (`icn1`) and Supabase in Seoul (`ap-northeast-2`), every round trip from an Indian wedding venue traverses thousands of kilometers. When a single user tap triggers two sequential network calls (`await callA(); await callB();`), the user pays the network round-trip latency twice. If each request takes 3–5 seconds on congested venue Wi-Fi, the runner waits 6–10 seconds for a single button tap. Actions requiring multiple operations must be consolidated into a single atomic server action or Postgres RPC, run in parallel with `Promise.all`, or have secondary cleanup offloaded to the background after the UI has already moved.

- **Pass condition:** No handler contains two awaited network calls in sequence.
- **Right:** `src/lib/actions/review.ts` (lines 17–41, specifically line 24; and `src/lib/actions/review-audit.ts` line 70) invoking `apply_rsvp_extraction()`, which updates group RSVP status, updates confirmed PAX, writes remarks, and upserts arrival/departure legs in a single atomic database RPC round trip.
- **Wrong:** `src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx` lines 176–204 in `handleSave()`, which awaits `saveRsvpLog(...)` on line 176 and then sequentially awaits `releaseGroupAfterCall(...)` on line 204. While this incurs a sequential two-round-trip penalty over venue Wi-Fi, the second call is NOT redundant. In the database, `save_rsvp_log`'s latest definition (`supabase/migrations/20260807000502_code_auth_attribution.sql:133`, lines 194–195) sets `locked_by = null, locked_until = null`, but does not touch `locked_by_staff` because `locked_by_staff` was added later (`20260808100000_attribution_split.sql`) and no subsequent migration updated `save_rsvp_log`. For a field/team session, `claim_group` (`20260814140000_remove_staff_identity_gate.sql:121–124`) writes `locked_by = null, locked_by_staff = <staff id>`. Nulling `locked_until` in `save_rsvp_log` does end the lock's blocking effect (since all lock checks require a non-null, future `locked_until`), but the second call to `releaseGroupAfterCall(...)` invokes `release_group` (`20260814140000:154–155`), which clears all three columns and thereby cleans up `locked_by_staff`. Without that second call, an `ON DELETE RESTRICT` reference to `staff_members` (`CLAUDE.md §5.9`) would remain dangling on every family logged by a team session. (Note that the code comments at `RsvpLogForm.tsx:189–191` and `src/lib/actions/rsvp.ts:26–27` are themselves imprecise in calling this second call "the belt to that braces"; the sequential call cannot simply be deleted without updating the database RPC).

---

### T6. Motion is confirmation, never transition.

Low-tier Android processors have weak GPU rasterization; running CSS layout translations during screen transitions causes dropped frames, jitter, and perceived lag. Staff navigating an event need fast clarity, not decorative 280ms entrance slides. Animation is justified only as physical confirmation of an irreversible action (such as the seal stamping down on proof capture) or semantic indication of pending work (`@utility breathe` 2800ms for queued rows). Everything on the touch path must use `--ef-duration-press: 100ms` (`duration-press`) and nothing else.

- **Pass condition:** The `pointer: coarse` block in `src/app/globals.css` stops being necessary, because nothing on a phone animates layout on navigation.
- **Right:** Reserving high-duration animation exclusively for irreversible confirmation, such as `@utility seal-in` (`nv-seal 900ms var(--ef-ease-seal)`) in `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx`, while interactive taps use only `--ef-duration-press: 100ms` without layout translation.
- **Wrong:** Animating navigation and layout entrances with `.list-fade` (`nv-rise 280ms`), `.push-in` (`nv-push 240ms`), and `.grow-x` (`nv-grow 900ms`), which caused dashboard cards to re-animate and jump on every tab switch. This required adding the `@media (pointer: coarse)` override in `src/app/globals.css` (lines 550–557) to disable them on mobile devices.

---

### T7. Offline is a state, not an error.

On venue Wi-Fi, network failure is a constant operational condition, not an exceptional error (`CLAUDE.md §11b`: "Wi-Fi drops → wait. Do NOT reload"). When a write occurs while disconnected, the app must never show an error popup, dump a network exception, or spin indefinitely. Every write must fall into one of three honest states: (1) Saved (server confirmed), (2) Saved on this phone (stored in IndexedDB / local outbox queue, ready to sync), or (3) Not saved (validation failure or permanent hard error, explained with plain-language recovery steps). Runners must know their captured data is safe without wondering whether it vanished into the void.

- **Pass condition:** No write path can reach a silent success or an indefinite spinner.
- **Right:** `src/components/ui/SyncChip.tsx` displaying `"3 waiting to upload · deliveries"` backed by IndexedDB storage (`src/lib/proof-queue.ts`), alongside `src/components/native/OfflineBanner.tsx` displaying `"Offline — N changes queued"` at the top of the viewport.
- **Wrong:** `src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx` (lines 176–187): when `saveRsvpLog` returns an error, line 182 calls `setSaving(false)` unconditionally and displays `result.message` (which `src/lib/actions/rsvp.ts` line 99 has sanitized via `friendlyDbError()`), so returned errors do not trap the form in saving. However, no `try/catch` wraps lines 176–181, so an *unhandled rejection* (such as a transport or network abort) would bypass `setSaving(false)` and leave `saving` true indefinitely with the button disabled. Furthermore, the path lacks an offline outbox queue to store the RSVP outcome locally on the handset when venue connectivity drops completely.

---

## Budgets

In V1, timing instrumentation is recorded through `traceFetch` in `src/lib/perf.ts`, which wraps fetch operations with `performance.now()` and logs formatted wall-clock timings as `[perf] <label>: <ms>ms` to `console.log` (visible in `adb logcat` on handset WebViews and captured by Playwright probes). In V12, these budgets will be enforced as hard pass/fail thresholds in automated tests.

The budgets below were set on 2026-09-21 from the first real measurement of this app, taken
at commit `23dacc2`. The numbers, the throttle profiles, what could be measured and what
could not are all in `docs/FEEL-BASELINE.md`; each budget says in one line which of those
numbers it came from, and which it deliberately did not:

| Metric | Target Budget | Measurement Method / Anchor | Rationale |
|---|---|---|---|
| `tap-to-visual-feedback` | **≤ 100ms** | MutationObserver armed before the click; see `docs/FEEL-BASELINE.md` | SET FROM T1, NOT FROM THE MEASUREMENT. Measured 2026-09-21 at `23dacc2`: **2258–3172ms** on a real family-row tap. The measurement shows the size of the gap, not a softer target. |
| `tap-to-destination-frame` | **≤ 300ms** | Not yet measured — see the gap list in `docs/FEEL-BASELINE.md` | Unmeasured, so set from the nearest evidence: `arrivals` already loads in 1323ms and a cached frame should be a fraction of a full load. 300ms is where a tap stops reading as "nothing happened". |
| `tap-to-content` (cached list) | **≤ 150ms** | TanStack Query cache read + paint; `--ef-duration-fade` in `src/app/globals.css` | A cached list should paint in roughly one frame budget plus a fade. Nothing measured meets it yet — no route was visited twice inside the 30s stale window during the run — so this remains the assertion that V2 works. |
| `tap-to-content` (uncached list) | **≤ 2000ms** | `traceFetch` in `src/lib/perf.ts`; initial query fetch | Measured 2026-09-21 at `23dacc2`: `arrivals` 1323ms, `rsvp-queue` 1814ms, `guest-list` 3299ms, `rooms` **6303ms**. 2000ms is met by two of the four and is a real target for the rest. Deliberately NOT set at `rooms`' 6303ms — that route needs work, not a budget that ratifies it. |
| One action's total server time | **≤ 500ms** | Server Action / Supabase RPC execution time logged via `traceFetch` | Unchanged. Not measured yet — it needs server-side timing, which `traceFetch` already emits. |

---

## The Six States Every Screen Must Have

Every screen in EventFlow must account for exactly six operational states. Five of these states are serviced by dedicated, reusable components; one currently has no component in the repository:

| State | Purpose & User Experience | Serving Component in Repo |
|---|---|---|
| **1. First load** | Initial paint before any data is cached on the handset. Renders a structural skeleton matching the destination layout to prevent jarring reflows. | `src/components/ui/LoadingRows.tsx` (`LoadingRows` for lists), `src/components/ui/PageLoading.tsx` (`PageLoading` for full-page boundaries) |
| **2. Empty** | Query succeeded, but zero records exist (e.g. no guests imported yet, or active filter matches nothing). Explains the void and provides a clear next action. | `src/components/ui/EmptyState.tsx` (`EmptyState`) |
| **3. Has-content** | Settled default state displaying loaded data in daylight-legible high contrast on warm ivory paper ground. | `src/components/ui/ListRow.tsx` (`ListRow`), `src/components/ui/Card.tsx` (`Card`), `src/components/ui/Badge.tsx` (`Badge`) |
| **4. Content-plus-pending write** | A write mutation has been triggered. Existing content remains completely interactive while the write reconciles with the server in the background. | `src/components/ui/UndoBar.tsx` (`UndoBar`), `src/lib/mutate/useOptimisticAction.ts` |
| **5. Load failure** | Network drop or server error prevented loading data. Plain-language explanation of what happened with a one-tap retry button. No raw SQL codes. | `src/components/ui/ErrorState.tsx` (`ErrorState`) |
| **6. Offline** | Device lost connection, or has pending writes queued in local storage (IndexedDB). Honestly displays queue status without blocking user interaction. | `src/components/native/OfflineBanner.tsx` (`OfflineBanner`), `src/components/ui/SyncChip.tsx` (`SyncChip`) |

### Serving State 4: Content-Plus-Pending Write

State 4 is serviced by `src/components/ui/UndoBar.tsx` and `src/lib/mutate/useOptimisticAction.ts`.

When a reversible mutation occurs:
1. The UI updates immediately without blocking user input or showing full-page spinners (Rule T2).
2. `UndoBar` displays a 7-second non-blocking bar above the bottom navigation allowing the user to tap "Undo" or tap to keep.
3. If the server rejects the write in the background, `UndoBar` announces and presents a clear rollback notice ("That did not save.") with a dismiss button.
