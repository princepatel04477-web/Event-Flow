---
tags: [status]
updated: 2026-07-31
---

# Status

Back to [[EventFlow]]. As of **31 July 2026**.

## Done

**`p1a` — Database schema, RLS, audit triggers.**
7 migrations, ~1,663 lines. Covers all 19 SRS sections, not just Phase 1.
See [[Schema Overview]].

**`p1b` — `test_security.sql`, 8 tests.**
Cross-event insert blocked, client sees nothing in base tables, a phone claiming 2020 gets
stamped with real server time, room capacity guard fires, two callers cannot lock the same
group. See [[Security Tests]].

## Repo state — read before writing code

> [!warning] The application does not exist yet
> The repo contains SQL only. The next code written is the first application code.

- No `package.json`, no `supabase/` directory, no Next.js app
- **Not a git repository** — `git init` is still pending
- Migration files sit at the **repo root**, not in `supabase/migrations/`
- `CALLING_MASTER_LIST.xlsx` is **not in the repo** — `p1c` needs it
- The migrations have **not been applied to the live Supabase project**

That last point matters. `p1a` and `p1b` were verified against a separate Postgres 16
instance. The live EventFlow project runs **Postgres 17** and is not linked. Re-run
[[Security Tests|test_security.sql]] there after the first push. See [[Supabase Project]].

## Next up

**`p1c` — Excel import.** The line that turns an empty database into 238 real families.
Column mapper, mobile normalisation, idempotent by row hash, preview before write.
See [[Excel Import]].

Then, in order:

| | |
|---|---|
| `p1d` | auth, event switching, role routing |
| `p1e` | calling queue |
| `p1f` | call screen |
| `p1g` | native call-recording module |
| `p1h` | upload → transcribe → extract |
| `p1i` | review screen |
| `p1j` | Excel export |

See [[Roadmap]] for phases 2–5.

## Working rules

- Start each session by stating the task's goal and its **definition of done**
- End each session by committing to Git **and testing on a real Android phone**
- Record every non-obvious decision in `DECISIONS.md` as it is made
- If a task isn't finished, **simplify it on the spot** rather than borrowing from the next one
- After feature freeze, the answer to every "can we also add…" is "after the event"
