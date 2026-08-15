# §4.5 — Google Distance Matrix integration: scope report

**Status: report only. No code, no dependency added.**

## API key management

- The app's env discipline is strict (CLAUDE.md §3): **only three Vercel env vars exist** —
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `APP_JWT_SECRET`. A Distance
  Matrix key is server-only (it is billable) and must NOT be a `NEXT_PUBLIC_` var (that prefix
  means published to the client bundle).
- **Where it lives:** a new server-only env var on Vercel, e.g. `GOOGLE_DISTANCE_MATRIX_API_KEY`,
  read only inside server actions (the `logistics.ts` / `fleet.ts` server-action layer). It
  never reaches the client.
- **Same pattern as `APP_JWT_SECRET`** — present on the server, absent from the repo and from
  any client bundle. The existing instrumentation (client-bundle secret scan) should grep for
  the new key's prefix after it's added.
- **Restriction:** the key should be restricted in Google Cloud Console to the Distance Matrix
  API only, with an HTTP referrer/IP restriction if possible (server-side calls use the API key
  with no referrer, so an IP allowlist of Vercel's egress is the realistic limit).

## Estimated cost at ~465 guests

- A wedding at ~465 guests is ~238 family groups. If each group needs one origin→destination
  pair per leg (arrival + departure), that is ~476 requests per event.
- Distance Matrix Advanced pricing (2026): $5 per 1000 elements (base) — elements = origins ×
  destinations. For 1:1 lookups, 476 elements ≈ **$2.38/event**.
- If the team instead asks for *route suggestions* (pickup-point → venue for N possible
  vehicles), a modest over-fetch of, say, 2× the leg count keeps it **under $5/event**.
- **Order of magnitude: single-digit dollars per event.** Not a budget item; worth doing
  because route time is currently a fixed constant in `pack.ts` (`travelTimeToVenueMinutes`).

## Rate limits

- Distance Matrix Advanced: 600 requests/minute per project by default (can be raised). At
  ~500 requests spread across a day, this is a non-issue. The app's existing rate-limit
  discipline (2 msg/sec in the messaging path) is the pattern; a small in-flight queue with
  a 5-10 req/sec cap is trivial.
- **Never in a client loop** — a re-render that re-fires N distance calls is a billable
  accident. All calls happen server-side, cached per (origin,destination) for the event.

## Failure path when the API is down / key rejected

- **Graceful degradation is mandatory** (the runbook's exact ask). Distance Matrix is an
  *enhancement* to a number that already has a sensible default: `travelTimeToVenueMinutes`
  (60) + `routeBufferMinutes` (90) in `pack.ts`.
- The design: try the API with a short timeout (2s); on any error (network, 4xx key reject,
  5xx), **fall back to the constant and mark the trip's route time as "estimated, not
  measured"** in the UI. A rejected key must not fail the pack.
- The key being rejected (401/403) is a *config* error, not a transient one — it should log a
  Sentry error and keep using constants, not retry and burn money.

## What the system does WITHOUT it (graceful degradation)

- Today: `pack.ts` uses fixed `travelTimeToVenueMinutes` (60) + the new configurable
  `routeBufferMinutes` (90). That is the fallback, and it is already in production.
- With Distance Matrix: each leg's origin→venue time replaces the constant per-leg, and the
  pack engine uses the real number. The buffer stays as a configurable safety margin.
- **Recommendation: build the fallback-first.** The constant path is the behaviour today;
  Distance Matrix is a per-leg override that can only make the plan more accurate, and its
  absence can never block a plan.

## Scope decision (for Prince)

- **In scope when built:** server-only env var, server action `estimateRouteTimes(eventId,
  legs)` with timeout + fallback, per-leg time stored on the proposal (derived, never stored
  in a table — it's a query-time value like the rest of §3), cache per (origin,destination).
- **Not in scope:** client-side calls, API key in the bundle, any stored aggregate.
- **Cost ceiling:** cap total requests per event (e.g. 2,000) to bound a runaway loop.
