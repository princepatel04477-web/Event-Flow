# Feel baseline — NOT CAPTURED

**Status: BLOCKED. This file is not a baseline and contains no measurements.**

V1 was supposed to record what a runner actually waits for — M1–M5 across five routes at two
network-throttle profiles — and then replace the `[PROPOSED]` markers in
`docs/INTERACTION-CONTRACT.md` with real numbers. It could not, because the Playwright test
runner cannot execute a test in the environment this session ran in. The harness was built;
the measurement never happened.

## What was built

- `playwright.config.ts` — a new `feel` project (`testMatch: /feel\.spec\.ts/`, Pixel 5,
  360×800), deliberately separate from `phone` for the same reason `perf` is separate: the
  `phone` project's `testMatch` is the scored acceptance set, and a timing harness must not
  fold its measurement noise into that scoreboard.
- `package.json` — `"test:feel": "npx playwright test --project=feel"`.
- `e2e/feel.spec.ts` — M1–M5 over the five routes, with CDP network throttling at two
  profiles (venue-Wi-Fi 300 ms RTT / 1.5 Mbps, 4G 150 ms / 4 Mbps), 5 iterations each,
  reporting median and worst per metric plus per-route request counts and byte totals.
- The test event is seeded to full scale: 543 `SEED-543` guests across 238+ families,
  against `E2E_EVENT_ID` (a dedicated test event, not the deployed one).

**The spec has never executed successfully.** It was written by an agent that could not run
it. It is committed so the work is not lost — not because it is known good. Expect to spend
the first run on it fixing selectors.

## The blocker, with evidence

Playwright's runner hangs *before it evaluates any spec module*. Reproduced three ways:

| Check | Result |
|---|---|
| `npx playwright test --project=feel --reporter=line` | hangs, no output, no browser process appears |
| `npx playwright test --project=probe` — a trivial canary spec, no helpers, no db, no auth | hangs before the spec's top-level code runs |
| `npx playwright test --project=phone e2e/tier0.spec.ts` — **the repo's own pre-existing suite** | hangs identically |

The third row is the one that matters: this is **not** a defect in the new harness. The
`phone` suite predates this work and hangs the same way, so the Playwright test runner cannot
run in this environment at all, for any project.

Ruled out directly, one at a time:

- **The browser.** A standalone script launched Chromium in **434 ms**
  (`chromium-1234`, v151.0.7922.34), opened a page, rendered `setContent`, and closed cleanly.
- **A missing browser revision.** `%LOCALAPPDATA%\ms-playwright` holds chromium-1228,
  chromium-1234, both headless shells, firefox and webkit; `chromium.executablePath()`
  resolves to a real file.
- **stdio pipes.** `execSync` with piped stdio and `spawn` with
  `stdio: ['ignore','pipe','pipe']` both round-trip output correctly.
- **Named-pipe IPC** — how the runner talks to its worker processes on Windows.
  `child_process.fork()` with an `ipc` channel returned a message correctly.
- **Orphaned workers** left behind by the runs that were killed. Every `node.exe` on the box
  was the agent harness, the Next dev server, or an MCP server. No Playwright process
  survived.
- **Test discovery.** `npx playwright test --project=feel --list` lists exactly 1 test, so the
  config, the project match and the spec all load correctly *in-process*. Only spawning a
  worker hangs.
- **The app.** The dev server answers `HTTP 200` on `http://localhost:3000` throughout.

## What this means for the series

- V1 cannot produce a baseline here, so **the Budgets table in `docs/INTERACTION-CONTRACT.md`
  keeps its `[PROPOSED]` markers.** They have not been checked against measurement and are
  not agreed numbers.
- **V12 has the same dependency and cannot run here either** — it asserts tap budgets and feel
  budgets through this same runner. V1 and V12 both need a machine where
  `npx playwright test --project=phone` completes.
- V2–V11 do not need a browser and are unaffected by this.

## To produce the real baseline

On a machine where the runner works:

```bash
npm run dev                        # needs http://localhost:3000
node e2e/fixtures/generate.mjs     # idempotent
node scripts/seed-543.mjs          # idempotent, tops up to 543, never deletes
npm run test:feel
```

Then take the `[feel] <profile> <route> <metric> median=…ms worst=…ms requests=… bytes=…`
lines, write the table here with the date and `git rev-parse HEAD`, and replace each
`[PROPOSED]` marker in `docs/INTERACTION-CONTRACT.md` with a real number plus one line saying
why that budget was chosen.
