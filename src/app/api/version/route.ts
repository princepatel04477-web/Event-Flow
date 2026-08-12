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

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    {
      // Vercel injects this at build time. Locally it is undefined, which is
      // the honest answer for `next dev` — the smoke suite treats a missing
      // SHA as "not a real deployment" rather than as a match.
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      // Evaluated when the serverless function cold-starts, not at build.
      // Close enough to "when did this instance come up" to be worth having.
      servedAt: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
