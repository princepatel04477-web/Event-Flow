# Static Export Audit — Nuvent → Capacitor APK

**Date:** 2026-08-04
**Scope:** Next.js 15 App Router, TypeScript, Tailwind v4, Supabase (Postgres 16, Auth, Storage, Edge Functions, Realtime)
**Mode:** READ-ONLY. No source files modified.

## Verdict: **HEAVY**

This app is built as a **server-rendered, cookie-session application**, not a
static SPA. Every route resolves the event and viewer on the server through
`cookies()`-backed Supabase, auth flows through **middleware**, and all writes
go through **server actions**. There is no client-side data layer to fall back
on — converting to `output: 'export'` is a re-architecture, not a config
change. Per the M1 decision rule, **HEAVY → run M2-ALT (remote shell) and
revisit static export after the event.**

---

## 1. BLOCKERS

### 1a. Server actions (`'use server'`) — 12 files, ~57 exported functions

Every write in the app is a server action. These cannot exist in a static
export (there is no Node runtime to host them). Each action uses the
cookie-session server client and `redirect()`/`revalidatePath()`.

| File | What it does |
|---|---|
| `src/lib/actions/auth.ts` | `signIn` (email+password), `signOut`. Uses `revalidatePath` + `redirect`. |
| `src/lib/actions/import.ts` | Excel import: parse + bulk insert guest groups/guests/travel legs. |
| `src/lib/actions/call.ts` | Claim group, start call attempt, submit outcome (the calling funnel). |
| `src/lib/actions/queue.ts` | Queue reads/actions. |
| `src/lib/actions/review.ts` | Accept/reject AI-extracted call details. |
| `src/lib/actions/rooms.ts` | Room assign/move/release + capacity override. |
| `src/lib/actions/fleet.ts` | Fleet quick-add, delete vehicle. |
| `src/lib/actions/logistics.ts` | Pack trips, commit trips. |
| `src/lib/actions/departures.ts` | Search groups, save departure (incl. cab expense). |
| `src/lib/actions/messages.ts` | WhatsApp templates, send, webhook handling (10 functions). |
| `src/lib/actions/dashboard.ts` | Dashboard + today-leg + attention reads (server-side). |
| `src/lib/actions/events.ts` | Create event, resolve by code. |

### 1b. API route handlers — 2 files

| File | What it does | Blocking reason |
|---|---|---|
| `src/app/api/messages/webhook/route.ts` | POST receiver for WhatsApp BSP status callbacks. Public, validates, silent-200s. | A public server endpoint — cannot be static. Must move to an Edge Function (it receives Meta's webhook, needs a stable public URL). |
| `src/app/auth/callback/route.ts` | PKCE callback: `exchangeCodeForSession(code)`, then redirect. | Server-only (reads `request.url`/headers, exchanges code). Currently only reachable if magic links are used. **Auth is email+password (see §5), so this route is effectively dormant** — keep for Edge Function only if email links are ever enabled. |

### 1c. Middleware — 1 file + helper

| File | What it does | Blocking reason |
|---|---|---|
| `src/middleware.ts` + `src/lib/supabase/middleware.ts` | `updateSession()`: refresh session cookie on every request, bounce anonymous users to `/login`. | Middleware is a server (edge) construct. In a static export there is no request layer to run it. Its job must move client-side (guard in layout + client auth state). |

### 1d. `next/headers` (cookies) — server client

`src/lib/supabase/server.ts` uses `cookies()` from `next/headers` to build the
`createServerClient`. This is the backbone of **every page and every server
action**. In a static export there are no cookies to read; the session must
move to `localStorage`/Capacitor Preferences with the browser client.

**Every server component page** (`src/app/**/page.tsx`, ~20 files) calls
`createClient()` from `src/lib/supabase/server` and `resolveEventByCode()` /
`requireStaff()` / `getViewer()` — all of which depend on the cookie client.
This is the deepest blocker: the entire data-fetching model is server-side.

### 1e. Dynamic route segments — 19 pages use `params: Promise<...>`

All keyed on `[eventCode]` (a short, admin-chosen slug) or database ids:

- `(staff)/[eventCode]/` — dashboard, queue, call/`[groupId]`, review,
  review/`[extractionId]`, import, rooms, rooms/allocate, fleet, logistics,
  logistics/sheets, departures, guests + `layout.tsx`
- `(admin)/admin/events/[eventCode]/` — dashboard, ledger, messages,
  messages/log, messages/templates

`[eventCode]` is a **stable slug** (uppercase code, e.g. `SHARMA26`) — knowable
at build time in principle but NOT enumerable without a live DB read, and it
changes per tenant. `[groupId]` and `[extractionId]` are **database UUIDs** —
NOT knowable at build time. All three require either `generateStaticParams`
with a server data source (impossible in static) or conversion to
query-param routes with client-side fetching.

### 1f. Server-only imports

`src/lib/supabase/queries.ts` and `server.ts` import `server-only` semantics
via `@supabase/ssr` server client. `next/image` is not used (icons are inline
SVG), but the `design-system` evidence page and all pages render server-side.

### 1g. Search params

`QueueBoard.tsx` uses `useSearchParams()` without an obvious Suspense wrapper
inside the client component tree — would need a boundary for static export.

### 1h. Config

`next.config.ts` is empty (no rewrites/redirects/headers today) — so the config
itself is not a blocker, but `output: 'export'` + `images.unoptimized` +
`trailingSlash` would be required.

---

## 2. DYNAMIC ROUTES

| Route | Param | Knowable at build? | Proposed conversion |
|---|---|---|---|
| `/[eventCode]` (dashboard) | event slug | No (tenant data) | `/?event=<code>` client-fetched, or keep param + `generateStaticParams` off (impossible) → use query param |
| `/[eventCode]/queue` | slug | No | `/?event=<code>&view=queue` or `[eventCode]` → query |
| `/[eventCode]/call/[groupId]` | **DB UUID** | **No** | `/call?groupId=<uuid>` client-fetched |
| `/[eventCode]/review/[extractionId]` | **DB UUID** | **No** | `/review?extractionId=<uuid>` client-fetched |
| `/[eventCode]/rooms`, `fleet`, `logistics`, `departures`, `import`, `guests`, `rooms/allocate`, `logistics/sheets` | slug | No | `/?event=<code>&view=...` |
| `/admin/events/[eventCode]/...` | slug | No | `/admin?event=<code>&view=...` |

Every one of these is a **multi-screen app flow keyed on live data**, not a
content site. Converting them all to query params + client fetching means
rebuilding the data layer, auth guard, and every page's loading/error model.

---

## 3. MIGRATION PLAN

| Blocker | Classification | Justification |
|---|---|---|
| 12 server-action files | **(a) DELETE → CONVERT TO CLIENT** | RLS on `event_id` is the security boundary (CLAUDE.md §5). The anon key client can call the same tables/views directly. The audit_log trigger records the real user — no service role needed. **BUT** this is a full rewrite of every write path, not a delete. |
| `/api/messages/webhook` | **(b) MOVE TO EDGE FUNCTION** | Public Meta webhook needs a stable URL + secret validation — must stay server-side. |
| `/auth/callback` | **(b) MOVE TO EDGE FUNCTION** | Only if email links enabled (currently dormant — email+password). |
| Middleware (`updateSession`) | **(a) DELETE → client guard** | Session guard moves into the root layout + client auth state (Supabase `onAuthStateChange`). |
| `server.ts` cookie client | **(a) DELETE → browser client** | Replace with `createBrowserClient` + Capacitor Preferences storage (M4). Every server component fetch moves client-side. |
| 19 dynamic routes | **(c) CONVERT TO CLIENT + query params** | As §2. |
| `useSearchParams` without Suspense | **(c) CONVERT TO CLIENT** | Wrap in `<Suspense>`. |
| Service role key | **Not present in repo** | Grep found no service-role client. The anon key is the only key, and it is public. Good — nothing to protect beyond keeping the anon key out of any server bundle (it is `NEXT_PUBLIC_` by design). |

---

## 4. EFFORT ESTIMATE

- **~57 server actions** to convert to direct Supabase client calls (or a
  client-side write layer): the biggest chunk.
- **20 server components** to convert to client components with
  loading/error/empty states.
- **19 dynamic routes** to query-param conversion + every `<Link>` /
  `router.push()` / `redirect()` target update.
- **Auth** rewrite from cookie session to token-in-storage + refresh.
- **Middleware** removal + client guard.

**Rough estimate: 3–5 focused days** for a clean conversion, assuming no
schema/RLS changes. That does not fit the 22-day schedule alongside M3–M11.
This is why the plan's decision rule exists: **take M2-ALT and reclaim the
days.**

---

## 5. AUTH METHOD CHECK (for M4)

**Email + password.** `src/lib/actions/auth.ts` calls
`supabase.auth.signInWithPassword({ email, password })`. No magic links, no
invite links in active use. `/auth/callback` exists for PKCE but is dormant.

→ M4 deep-link work is **NOT required**. We skip the custom URL scheme and
`exchangeCodeForSession` flow.

---

## 6. VERDICT

**HEAVY** — >15 blockers, and the server-secret-free-but-server-shaped data
layer (server actions + cookie session) is threaded through every screen.
Per the M1 gate: **run M2-ALT (remote shell), not M2.**
