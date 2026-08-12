import { NextResponse } from 'next/server'

/**
 * What is actually serving this URL.
 *
 * EXISTS BECAUSE "DEPLOYED" HAS BEEN WRONG TWICE. `extract-rsvp` was reported
 * deployed and was not; the voice recorder was reported built and was a
 * placeholder. Both times the only way to find out was to use the feature and
 * watch it fail. Neither the Vercel dashboard nor a 200 from the login page
 * distinguishes "the code you just wrote" from "code from nine hours ago" —
 * every deployment keeps its own immutable URL and answers 200 forever, so a
 * stale URL looks exactly like a fresh one.
 *
 * The smoke suite reads this and compares the SHA to the local git HEAD. That
 * check is the difference between "the site is up" and "the site is running
 * what I think it is".
 *
 * Deliberately unauthenticated and deliberately boring: a commit SHA, a branch
 * name and a build timestamp are not secrets, and requiring a session would
 * make the check impossible to run before a session can be established. No
 * env values, no config, nothing that is not already public in the repo.
 *
 * DELIBERATELY ONLY TWO FIELDS. This endpoint is unauthenticated, so it
 * returns the commit SHA and the time this instance came up, and nothing
 * else. `branch`, `message`, `environment` and `region` were dropped: a
 * branch name and a commit subject describe unreleased work to anonymous
 * callers, and none of the four are needed to answer "what is deployed".
 * scripts/smoke.mjs depends only on `commit`; it prints branch and region
 * when present and falls back to '?' when they are not.
 */

/**
 * M2: `force-dynamic` is GONE, and it had to be — `output: 'export'` refuses it
 * outright ("cannot be used with output: export"). This is now prerendered to a
 * static file at build time.
 *
 * WHAT THAT CHANGES, because it is not nothing:
 *
 *  - `commit` is unaffected and arguably stronger. It is baked from the build
 *    that produced this file, so it cannot report a SHA that differs from the
 *    bundle being served. scripts/smoke.mjs compares it to local git HEAD and
 *    that comparison keeps working.
 *  - `servedAt` NO LONGER MEANS "when this instance came up". There is no
 *    instance. It is now the BUILD time, frozen. Anything treating it as a
 *    liveness or uptime signal is reading a constant — renamed in spirit, not
 *    in key, because scripts/smoke.mjs reads `servedAt` and silently renaming
 *    it would break the suite that exists to catch stale deploys.
 *  - `cache-control: no-store` is advisory now; a static file is served by the
 *    CDN under its own rules. Kept so the intent survives if this ever returns
 *    to a server.
 *
 * The reason this endpoint exists is unchanged and still earned: "deployed" has
 * been wrong twice (extract-rsvp reported deployed and was not; the voice
 * recorder reported built and was a placeholder). A baked SHA answers "what is
 * actually in this bundle" better than a cold-start timestamp ever did.
 */
// Required, not redundant: with `output: 'export'` a route handler must declare
// force-static explicitly. Omitting it fails the build with "force-static /
// revalidate not configured" rather than defaulting to static.
export const dynamic = 'force-static'

export function GET() {
  return NextResponse.json(
    {
      // Vercel injects this at build time. Locally it is undefined, which is
      // the honest answer for `next dev` — the smoke suite treats a missing
      // SHA as "not a real deployment" rather than as a match.
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      // Build time, frozen at export. See the note above.
      servedAt: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
