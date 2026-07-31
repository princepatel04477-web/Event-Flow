export const meta = {
  name: 'eventflow-phase1',
  description: 'Build EventFlow Phase 1: app shell + auth, then Excel import, calling queue, call screen and review screen, each adversarially verified',
  phases: [
    { title: 'Foundation', detail: 'UI primitives, auth, event switcher, staff shell' },
    { title: 'Features', detail: 'import / queue / call / review, one agent each' },
    { title: 'Verify', detail: 'adversarial check of each slice against the schema' },
    { title: 'Integrate', detail: 'fix typecheck, lint and build across the whole app' },
  ],
}

const ROOT = 'C:/Users/rebel/OneDrive/Documents/Projects/EventFlow'

const CONTEXT = `
PROJECT ROOT: ${ROOT}

You are building EventFlow, a multi-tenant wedding event operations platform.
Next.js 15 App Router + TypeScript + Tailwind v4 + Supabase. The database schema is
ALREADY BUILT AND LIVE — you are writing application code against it, never changing it.

READ THESE FIRST, in this order. They are the source of truth and they will save you
from rediscovering traps that are already documented:
  1. ${ROOT}/CLAUDE.md
  2. ${ROOT}/eventflow/Database/Schema Reality Check.md   <-- where docs disagree with SQL
  3. ${ROOT}/eventflow/Ops/Known Traps.md
  4. ${ROOT}/src/lib/supabase/database.types.ts           <-- generated from the LIVE schema
  5. whichever eventflow/ notes cover your specific area

HARD RULES — violating any of these produces broken or insecure code:

* Use the existing clients. \`import { createClient } from '@/lib/supabase/server'\`
  (async, for server components / actions) or '@/lib/supabase/client' (browser).
  NEVER construct a Supabase client inline. NEVER use a service_role key. Every write
  must run as the signed-in user so RLS and the audit triggers record who did it.
* Everything is fenced by event_id via RLS. Always pass event_id explicitly on insert.
  A query returning zero rows usually means "not permitted", not "no data".
* A non-admin DELETE returns 0 rows affected and NO error. Never read absence of error
  as success for a delete.
* Mobile-first, always: base font 16px, tap targets >= 44px, sticky headers, must work
  on a cheap Android phone on bad venue Wi-Fi. This is field software, not a dashboard.
* TypeScript strict. Run \`npx tsc --noEmit\` from the project root before you finish and
  fix every error in files you own.
* Tailwind v4 (CSS-first config, @import "tailwindcss" in globals.css). There is no
  tailwind.config.js and you should not create one.
* Do NOT edit: src/lib/supabase/database.types.ts, supabase/migrations/**, CLAUDE.md,
  package.json, any file under eventflow/.
* Do NOT create files outside the paths you are told you own. Other agents are working
  in this same repo at the same time; touching their files will cause conflicts.

Server Actions are the preferred write path. Use 'use server' modules, revalidatePath,
and return typed results rather than throwing raw Postgres errors at the UI.
`

const FILES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'files', 'notes'],
  properties: {
    summary: { type: 'string', description: 'What you built, 2-4 sentences' },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'Repo-relative paths you created or modified',
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Decisions, assumptions, stubs left, or things the next agent must know',
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'verdict'],
  properties: {
    verdict: { type: 'string', enum: ['clean', 'issues_found'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'severity', 'summary', 'failure'],
        properties: {
          file: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          summary: { type: 'string' },
          failure: { type: 'string', description: 'Concrete inputs -> wrong behaviour' },
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// PHASE 1 — Foundation. Everything else imports from this, so it runs alone.
// ---------------------------------------------------------------------------
phase('Foundation')

const foundation = await agent(
  `${CONTEXT}

YOU OWN THESE PATHS (create/modify only here):
  src/app/layout.tsx
  src/app/page.tsx
  src/app/globals.css
  src/app/(auth)/**
  src/app/auth/**
  src/app/(staff)/layout.tsx
  src/app/(staff)/[eventCode]/layout.tsx
  src/app/(staff)/[eventCode]/page.tsx
  src/components/**
  src/lib/utils.ts
  src/lib/actions/auth.ts

BUILD:

1. UI PRIMITIVES under src/components/ui/. Small, unstyled-ish, Tailwind, no external
   component library. Export from each file directly. Build exactly these, because four
   other agents are about to import them and must find them where expected:
     Button.tsx      variants: primary | secondary | danger | ghost; sizes: md (min-h-11) | lg (min-h-14); loading state
     Card.tsx        Card, CardHeader, CardBody, CardFooter
     Input.tsx       label, error text, 16px font (prevents iOS zoom)
     Select.tsx      native <select>, same label/error shape as Input
     Textarea.tsx
     Badge.tsx       tone: neutral | success | warning | danger | info
     Spinner.tsx
     EmptyState.tsx  icon slot, title, description, optional action
     StickyHeader.tsx  sticky top bar, safe-area aware, title + optional back + right slot
     Field.tsx       shared label/error wrapper used by Input/Select/Textarea
   Also src/lib/utils.ts exporting \`cn(...)\` (clsx-style class merge, write it by hand,
   do not add a dependency).

2. GLOBALS. src/app/globals.css: Tailwind v4 import, base font-size 16px, a neutral
   light/dark palette via CSS custom properties, safe-area padding helpers. Keep it small.

3. AUTH.
   - src/app/(auth)/login/page.tsx — email + password sign-in, server action, honours a
     \`?next=\` param. Friendly errors ("Wrong email or password"), never raw Postgres text.
   - src/app/auth/callback/route.ts — exchanges the code for a session, redirects on.
   - src/lib/actions/auth.ts — signIn, signOut server actions.
   - src/app/page.tsx — resolve the viewer via getViewer() from '@/lib/supabase/queries'.
     No session -> /login. Exactly one membership -> redirect to /\${eventCode}. More than
     one -> render an event picker. No memberships at all -> a clear "ask an admin to add
     you to an event" screen, NOT an error page.

4. STAFF SHELL.
   - src/app/(staff)/[eventCode]/layout.tsx — resolve the event by code via
     getEventByCode(). Not found or not permitted -> notFound(). Render StickyHeader with
     the event name, an event switcher when the viewer has more than one membership, and
     bottom tab navigation (Queue / Import / Review / Dashboard) sized for thumbs.
     Note params is a Promise in Next 15 — \`const { eventCode } = await params\`.
   - src/app/(staff)/[eventCode]/page.tsx — dashboard reading the v_event_dashboard view.
     Show eight counters as large tap-friendly cards: total groups, total pax, RSVP
     confirmed, RSVP pending, arrivals today, departures today, hampers delivered,
     hampers pending.

IMPORTANT: the route group is (staff) and the dynamic segment is [eventCode], matching the
short \`events.code\` slug (e.g. SHARMA26), NOT the uuid. Other agents will add
src/app/(staff)/[eventCode]/{import,queue,call,review}/ — leave room for them and do not
create those directories yourself.

Verify with \`npx tsc --noEmit\` before finishing.`,
  { label: 'foundation', schema: FILES_SCHEMA },
)

log(`Foundation done — ${foundation?.files?.length ?? 0} files`)

// ---------------------------------------------------------------------------
// PHASE 2+3 — Feature slices, each verified as soon as it is built.
// pipeline() so the queue slice can be verified while review is still building.
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    key: 'import',
    label: 'p1c-excel-import',
    owns: `src/app/(staff)/[eventCode]/import/**
  src/lib/import/**
  src/lib/actions/import.ts`,
    brief: `TASK p1c — EXCEL IMPORT. This is the highest-value task in the project: it is the
line that turns an empty database into 238 real families. Read
${ROOT}/eventflow/Pipelines/Excel Import.md in full before starting.

The real workbook (CALLING_MASTER_LIST.xlsx) is NOT in the repo. Build for an unknown
sheet: a user-confirmed column mapper with sensible auto-detection, not hardcoded columns.

SheetJS is installed as \`xlsx\` (0.20.3, from the official CDN tarball). Parse in the
browser so nothing uploads before the user has approved the preview.

BUILD:
  src/lib/import/mapper.ts     ColumnMapping type; auto-detect headers by fuzzy match
                               (group code, head name, primary mobile, alt mobile,
                               expected pax, side, group type, city, remarks, return gift)
  src/lib/import/normalize.ts  normaliseMobile: strip spaces/dashes/brackets/+91/leading 0
                               AND Excel's trailing ".0" from numeric cells -> exactly 10
                               digits, else null with a reason.
                               parsePax: "6", "6 pax", "six", blank -> number | null.
                               rsvpFromRemarks: detect "Not Coming" -> declined,
                               "Not Sure" -> tentative, case-insensitive, from free text.
                               Also normalise casing noise like "4th" vs "4TH".
  src/lib/import/hash.ts       rowHash over the IDENTIFYING cells only (head name +
                               primary mobile + group code), NOT the whole row — otherwise
                               a corrected remark creates a duplicate family. Stable,
                               order-independent, hex digest.
  src/lib/import/parse.ts      read workbook -> raw rows, skip blank rows, carry the
                               original 1-based sheet row number through, handle merged
                               family rows by forward-filling the group columns.
  src/lib/actions/import.ts    server action that commits a reviewed import.

COMMIT SEMANTICS — get these exactly right:
  * Insert an import_batches row, then one import_rows row per sheet row carrying \`raw\`
    jsonb, row_number, row_hash and resulting status.
  * Upsert guest_groups on the partial unique index (event_id, source_row_hash).
    Re-running the same file must report 0 inserted / 0 updated / N skipped.
  * CRITICAL: for every group also insert a \`guests\` row for the family head with
    is_head = true. client_guest_profiles reads from guests, not guest_groups. Skipping
    this leaves the client's screen blank and the bug will not surface until Phase 2.
    At most one head per group is enforced by a partial unique index, so make the head
    insert idempotent too.
  * Set event_id explicitly on every insert.
  * Update the batch counters at the end.

UI FLOW (mobile-first): upload -> auto-mapped columns the user can correct -> PREVIEW with
a warning list -> confirm -> result summary. The preview must separate: new, will-update,
unchanged, and cannot-import (with the reason). NEVER write straight from the sheet — the
preview is on the never-cut list.

Rows that fail validation must not block the rest: import the good ones, list the bad ones.`,
  },
  {
    key: 'queue',
    label: 'p1e-calling-queue',
    owns: `src/app/(staff)/[eventCode]/queue/**
  src/lib/actions/queue.ts`,
    brief: `TASK p1e — CALLING QUEUE. Read ${ROOT}/eventflow/Database/Views and RPCs.md and
${ROOT}/eventflow/Database/Guests and RSVP.md first.

Built on the v_rsvp_queue view, which already computes attempt_count as a live count(*),
last_attempt_at, last_outcome, next_callback_at and is_locked. Do not recompute any of
these yourself and never store an attempt counter.

BUILD:
  * Queue list, sorted by priority desc then head_name. Each row is a large tap target
    showing head name, pax, rsvp_status badge, attempt count, and a lock indicator.
  * Filters: rsvp_status (multi), side, "callbacks due now" (next_callback_at <= now),
    and hide-locked. Keep filter state in the URL so a refresh survives.
  * Tapping an unlocked row calls the claim_group(p_group_id, p_minutes) RPC via a server
    action, then routes to /[eventCode]/call/[groupId].
  * claim_group raises 55P03 lock_not_available when another caller holds it. Catch that
    specific code and show "Someone else is calling this family right now" — not a crash,
    not a generic error. The lock is re-entrant for its current holder, so a caller
    reopening their own group must succeed.
  * Realtime: subscribe to postgres_changes on guest_groups for this event_id so lock
    state and rsvp_status update live across the 10-20 staff phones. Clean up the channel
    on unmount.
  * Empty state when the queue is empty, pointing at the import screen.

Do not build the call screen itself — another agent owns src/app/(staff)/[eventCode]/call/.`,
  },
  {
    key: 'call',
    label: 'p1f-call-screen',
    owns: `src/app/(staff)/[eventCode]/call/**
  src/lib/actions/call.ts
  src/lib/call/**`,
    brief: `TASK p1f — CALL SCREEN. Read ${ROOT}/eventflow/Database/Guests and RSVP.md and the
"tel:" section of ${ROOT}/eventflow/Ops/Known Traps.md before writing anything.

THE CENTRAL TRAP — get this wrong and the screen loses data in the field:
\`tel:\` backgrounds the browser and Android may discard page state entirely. So:
  1. Create the call_attempts row FIRST, via a server action, BEFORE the tel: link fires.
  2. Stash the returned attempt id in sessionStorage keyed by group id.
  3. On mount, ALWAYS check sessionStorage and rehydrate an in-flight attempt.
     The flow is RESUME-FIRST, not continue-first.

THE SECOND TRAP — call_attempts is append-only with ONE-SHOT completion:
  * started_at is stamped by the server; whatever the phone sends lands in
    device_started_at and is untrusted. Do not try to set started_at.
  * UPDATE is allowed only until \`outcome\` goes from null to non-null. At that instant a
    trigger stamps finalized_at and the row FREEZES FOREVER. Any later update raises 42501.
  * So: write ended_at + duration_sec + outcome + notes + callback_at in ONE update, when
    the caller submits. Never optimistically set outcome and correct it later.
  * DELETE is impossible. There is no undo. Make the submit button feel deliberate.

BUILD:
  * src/app/(staff)/[eventCode]/call/[groupId]/page.tsx — group context: head name, pax,
    side, city, remarks, previous attempts with outcomes, existing travel legs.
  * A big "Call <number>" button using a tel: href with the normalised 10-digit number.
  * Outcome capture, one tap each, matching the app.call_outcome enum:
    connected / no_answer / busy / switched_off / wrong_number / callback / declined / other.
    Choosing "callback" reveals a callback_at datetime picker.
  * Optional notes field. Submit writes the single freezing update.
  * After submitting, offer "release this family" (release_group RPC) and route back to
    the queue. Also release on explicit abandon.
  * Show the lock countdown from locked_until so a caller knows their 15 minutes.
  * Offline: if the network is down, queue the completion in IndexedDB (the \`idb\` package
    is installed) and drain it when back online. Venue Wi-Fi will fail. Show pending state
    honestly rather than pretending the write succeeded.

Do NOT build audio recording, transcription or extraction — that is p1g/p1h, out of scope
here. Leave a clearly marked placeholder where the recorder will mount.`,
  },
  {
    key: 'review',
    label: 'p1i-review-screen',
    owns: `src/app/(staff)/[eventCode]/review/**
  src/lib/actions/review.ts
  src/lib/review/**`,
    brief: `TASK p1i — REVIEW SCREEN. Read ${ROOT}/eventflow/Pipelines/Extraction Contract.md in
FULL before writing anything — the payload the RPC accepts is NOT the shape the model
emits, and getting it wrong silently drops data.

This screen is the guarantee that AI output is evidence, not data. It is on the never-cut
list. Nothing may auto-write.

BUILD:
  * List of rsvp_extractions with status 'pending' for this event, newest first, with the
    group's head name and the confidence summary.
  * Review detail: the transcript text alongside every extracted field, so the reviewer can
    check a claim against what was actually said.
  * Every field editable before commit.
  * Fields whose confidence is below 0.8 render AMBER with a visible warning. Read
    per-field confidence from the extraction's \`confidence\` jsonb, supporting dotted paths
    like "arrival.date".
  * Accept -> call apply_rsvp_extraction(p_extraction_id, p_payload). Reject -> set status
    'rejected' with review_notes, writing nothing to guest data.

THE PAYLOAD MAPPING — src/lib/review/payload.ts, with the translation isolated and unit-
testable. apply_rsvp_extraction reads ONLY these top-level keys and silently ignores
everything else:
    rsvp_status    -> guest_groups.rsvp_status
    confirmed_pax  -> guest_groups.confirmed_pax
    side           -> guest_groups.side          (reviewer-supplied; the model does not emit it)
    remarks        -> guest_groups.remarks       <-- the model's \`special_requests\` MAPS HERE
    arrival        -> travel_legs where direction='arrival'
    departure      -> travel_legs where direction='departure'
  Leg object keys are: mode, date, time, reference, point, pax
  (note \`pax\`, NOT \`pax_on_leg\`, even though the column is pax_on_leg).
  \`language\` and \`confidence\` are IGNORED by the RPC — keep them on the extraction row.

THREE BEHAVIOURS TO HANDLE IN THE UI:
  1. Every RPC assignment is coalesce(new, existing) — there is NO way to null a field out.
     If a reviewer clears a wrong flight number, it will silently stay. Detect that case and
     tell the reviewer plainly that clearing is not supported yet, rather than pretending
     it worked.
  2. Only the OLDEST leg per direction is updated (order by created_at limit 1). If a group
     already has more than one arrival leg, warn the reviewer that only the first is edited.
  3. The RPC only refuses re-applying an 'accepted' extraction. A 'rejected' one can still
     be applied — guard that in the UI.

apply_rsvp_extraction also clears the caller lock, so after a successful commit the family
is free for the queue again. Route back to the review list with a confirmation.`,
  },
]

const results = await pipeline(
  FEATURES,
  (f) =>
    agent(
      `${CONTEXT}

YOU OWN THESE PATHS (create/modify only here):
  ${f.owns}

The app shell, auth, event switcher and UI primitives already exist. Import primitives from
'@/components/ui/<Name>'. Available: Button, Card (+CardHeader/CardBody/CardFooter), Input,
Select, Textarea, Badge, Spinner, EmptyState, StickyHeader, Field. Plus \`cn\` from
'@/lib/utils'. Read the files before assuming an API.

Notes from the foundation agent:
${(foundation?.notes ?? []).map((n) => `  - ${n}`).join('\n') || '  (none)'}

${f.brief}`,
      { label: f.label, phase: 'Features', schema: FILES_SCHEMA },
    ),
  (built, f) =>
    agent(
      `${CONTEXT}

You are an ADVERSARIAL reviewer. Another agent just built the "${f.key}" slice. Your job is
to find where it is WRONG — not to praise it, not to restate what it does. Default to
skepticism, but only report defects you can point at in a specific file with a concrete
failure scenario. Do not fix anything.

Files it claims to have written:
${(built?.files ?? []).map((p) => `  - ${p}`).join('\n') || '  (none reported)'}

Its own notes:
${(built?.notes ?? []).map((n) => `  - ${n}`).join('\n') || '  (none)'}

Read those files. Then check, specifically and in this order:

1. SCHEMA TRUTH. Compare every table, column, enum value and RPC argument used against
   ${ROOT}/src/lib/supabase/database.types.ts. A hallucinated column name or a wrong enum
   value is a CRITICAL finding. Cross-check against
   ${ROOT}/eventflow/Database/Schema Reality Check.md.

2. THE SLICE'S OWN TRAP. Each slice has one thing it is most likely to get wrong:
   - import : does it create a \`guests\` row with is_head=true for every group? Is the row
              hash over identifying cells only? Is re-import genuinely a no-op? Does mobile
              normalisation handle the Excel ".0" decimal case?
   - queue  : does it catch 55P03 specifically? Does it recompute attempt counts instead of
              using the view? Is the realtime channel cleaned up?
   - call   : is the call_attempts row created BEFORE the tel: navigation? Is the id in
              sessionStorage and rehydrated on mount? Is outcome written exactly once in a
              single update, never optimistically?
   - review : does special_requests map to \`remarks\`? Is the leg key \`pax\` and not
              \`pax_on_leg\`? Does anything auto-write without human confirmation?

3. RLS AND TENANCY. Is event_id set explicitly on every insert? Any service_role usage? Any
   inline Supabase client construction instead of the shared helpers? Any place treating a
   zero-row result as "no data" when it means "not permitted"? Any delete whose success is
   inferred from the absence of an error?

4. MOBILE REALITY. Tap targets below 44px, font below 16px on inputs, anything that assumes
   a stable network, anything that would be unusable one-handed on a cheap Android phone.

5. Does \`npx tsc --noEmit\` pass? Run it from ${ROOT}. Report type errors in this slice's
   files as findings.

Report every real defect. An empty findings array is a valid and useful answer if the slice
is genuinely sound — do not invent problems to seem thorough.`,
      { label: `verify:${f.key}`, phase: 'Verify', schema: VERDICT_SCHEMA },
    ).then((v) => ({ feature: f.key, built, verdict: v })),
)

const slices = results.filter(Boolean)
const allFindings = slices.flatMap((s) =>
  (s.verdict?.findings ?? []).map((x) => ({ ...x, feature: s.feature })),
)
const critical = allFindings.filter((f) => f.severity === 'critical')
const major = allFindings.filter((f) => f.severity === 'major')

log(
  `Features built: ${slices.map((s) => s.feature).join(', ')} | ` +
    `findings: ${critical.length} critical, ${major.length} major, ${allFindings.length} total`,
)

// ---------------------------------------------------------------------------
// PHASE 4 — Integrate. One agent with the whole picture fixes what matters.
// ---------------------------------------------------------------------------
phase('Integrate')

const integration = await agent(
  `${CONTEXT}

You are the integrator. Four feature slices and a foundation were built in parallel by
separate agents that could not see each other's work. Your job is to make the whole app
compile, lint and build, and to fix the confirmed defects below.

You MAY edit any file under src/ EXCEPT src/lib/supabase/database.types.ts.

CRITICAL findings (fix all of these):
${critical.map((f) => `  [${f.feature}] ${f.file}\n      ${f.summary}\n      -> ${f.failure}`).join('\n') || '  (none)'}

MAJOR findings (fix these unless the fix is a rewrite; say so if you skip one):
${major.map((f) => `  [${f.feature}] ${f.file}\n      ${f.summary}\n      -> ${f.failure}`).join('\n') || '  (none)'}

MINOR findings (fix only if trivial):
${allFindings.filter((f) => f.severity === 'minor').map((f) => `  [${f.feature}] ${f.file} — ${f.summary}`).join('\n') || '  (none)'}

THEN, in order:
  1. \`npx tsc --noEmit\` from ${ROOT}. Fix every error. Do not silence errors with \`any\`
     or ts-ignore; fix the actual type.
  2. \`npx next lint\` (or \`npx eslint .\` if that fails). Fix real problems; you may relax
     a rule in eslint.config.mjs only if it is genuinely noise, and say which and why.
  3. \`npm run build\`. Fix whatever breaks. If the build fails only because sharp's install
     script was never approved, say so in your notes rather than working around it.
  4. Resolve duplication between slices: if two agents each wrote their own date formatter,
     mobile formatter, status-badge mapping or error helper, consolidate into src/lib/ and
     update the callers.
  5. Check the navigation in the staff layout actually links to the routes that now exist.

Report honestly. If the build does not pass at the end, say exactly what still fails and
why — do not claim success you did not achieve.`,
  { label: 'integrate', schema: FILES_SCHEMA },
)

return {
  foundation: foundation?.summary,
  features: slices.map((s) => ({
    feature: s.feature,
    summary: s.built?.summary,
    verdict: s.verdict?.verdict,
    findings: (s.verdict?.findings ?? []).length,
  })),
  findings: { critical: critical.length, major: major.length, total: allFindings.length },
  criticalDetail: critical,
  integration: integration?.summary,
  integrationNotes: integration?.notes ?? [],
}
