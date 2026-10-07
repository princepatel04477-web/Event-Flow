# MiroFish User Simulation — EventFlow

**Date:** 7 October 2026
**Tool:** [MiroFish](https://github.com/666ghj/MiroFish) — swarm-intelligence simulation engine (cloned to `.mirofish/`, gitignored).
**What was asked:** spawn the app's real users as agents, have them use EventFlow, and collect where the problems are.

---

## What was actually run

| | |
|---|---|
| LLM | **DeepSeek** (OpenAI-compatible) — `deepseek-flash` @ `https://api.deepseek.com` |
| Memory graph | **Zep Cloud** (the only backend MiroFish supports) |
| Seed material | `.mirofish/seed/eventflow-context.md` (the 7 personas, the screens, the hard rules, the known wounds) |
| Pipeline | ontology → Zep graph → personas → run → report |
| Graph built | **55 nodes, 66 edges** (16 chunks ingested) |
| Agents spawned | **16** (the 7 personas + hotels/org/staff fallbacks) |
| Run | Twitter platform, target 12 rounds / 96 simulated hours |
| Outcome | **Stalled after ~18 posts** (an untimed OASIS LLM call never returned); stopped, report generated from partial data |

**All raw data is collected in `.mirofish/out/`** (ontology, build result, run state, the 16 agent
profiles, the SQLite DB, the 18 posts, and the report sections). Nothing was discarded.

---

## The simulated users' findings (translated from the agents' own posts)

### Aditi — Calling Coordinator
Tapping a number **jumps out to the dialer; on return the queue resets to the top and the "no
answer" just recorded is gone.** They now dial first, write on paper, and back-fill at night —
which caused two calls to be logged against the same person and three already-confirmed families
to be re-called. Her ranking: **(1) lost state after a call, (2) queue duplication, (3) weak
network shows "saved" when it is only queued.**

### Ramesh — Caller
Distrusts the app. The dial button is small and makes him wait on a spinner while a guest waits,
so he talks first. After hanging up the app **sometimes says "saved" when it only queued, then
turns red — he cannot tell whether it recorded.** He uses the phone's call log and asks Aditi to
back-fill. The same number pops up three times a day.

### Priya — Hospitality Lead
**The Rooms board takes 10+ seconds to open** — a family waits in the lobby and the screen is
white. A family of six into two double rooms: **the system will not let her split directly and
gives no clear prompt**, so she deletes and re-splits — producing **duplicate check-in records**.
The **Rooming List with hundreds of rows stutters like a slideshow** on a cheap phone. Workaround:
plan on paper first, then back-fill; open the board as rarely as possible.

### Sunil — Hamper Runner
No signal in the basement. He takes the hamper photo, **the app says "saved" but upstairs the
delivery is gone — or the same room now has two entries with only one photo.** The rules say
photos cannot be edited, so he does not know which entry counts. Workaround: camera first, batch
upload later — which often fails. Worst case: **the proof is lost and the client disputes it.**

### Farah — Logistics Lead
Departure plans are made in the app but drivers do not use it, so she screenshots to WhatsApp —
**and a changed time means resending, with drivers reading the old image.** The system **assigned
the same family to two vehicles** because two coordinators dragged at the same moment, and **the
app does not tell her which version the driver saw.** WhatsApp is her real sheet; EventFlow is
just a draft.

### Vikram — Admin
**Importing CALLING MASTER LIST produced duplicate families, and deleting one corrupts the other's
status.** After issuing access codes, **some staff got the wrong role and could see what they
should not.** Not being able to delete proofs is right, **but when a client reports a duplicate he
cannot even mark which row is the duplicate.** His ranking: **duplicate import → room/vehicle
conflicts > permission mismatch > slow export.**

### Meera — Client
Wants only her own family's room number and who is arriving today. **Find returns a crowd; the
room number is stale; refresh is slow.** She is read-only **yet sees other families' information**,
which unsettles her. She gives up on the app and asks Vikram directly.

### The staff, as a group (their own consensus post)
Ranked: **(1) hamper photo fake-save + duplicates, (2) lost call-queue state, (3) Rooms board and
Rooming List slow to load, (4) the same task locked/duplicated by two people, (5) the client
read-only page showing wrong information.** Every one ends in pen-and-paper plus WhatsApp.

---

## Why this matters: it corroborates the real, code-level bugs

The simulation was run from the product context alone — it never saw the source. Yet its findings
land squarely on defects that were found by reading the code, which is a strong
independent-confirmation signal:

| Simulated-user finding | Real code issue | Status |
|---|---|---|
| Lost call state after a call; queue resets | `tel:`/dialer backgrounding + `SessionBridge` losing its resume listener (B1/B2) | **Fixed** |
| "Saved" when it only queued; can't tell saved vs queued | Offline-queue honesty + no "needs attention" surface (B4/B5/B6) | Partly fixed / **open** |
| Proof "saved" but delivery gone; duplicate proofs | Proof idempotency bug — retry minted a new key (B3) | **Fixed** |
| Rooms board / Rooming List slow, "sequential server requests" | Serial Supabase reads on the two boards + the shell (F1–F4) | **Fixed** |
| Rooming List stutters on a cheap phone | List not virtualized (L-VIRT) | **Open** |
| Duplicate families on import | Import idempotency | **Open** |
| Wrong role / client sees others' data | Access-code role mapping + client view row scoping | **Open** |
| Same task duplicated by two coordinators | Concurrent queue flush (B4) | **Fixed** |
| Arrival notice shows the wrong day early morning | UTC vs IST date (B11) | **Fixed** |
| Driver-sheet export slow on a phone | `xlsx` shipped eagerly into route bundles (L-XLSX) | **Open** |

---

## MiroFish's own report (generated)

The ReportAgent produced a 5-section outline and wrote section 2 in full
(`.mirofish/out/report/section_02.md`), titled *"Most severe blockages: room allocation,
check-in and departure planning fail first."* Its ranking of event-day damage:

1. **Room allocation** — "the app makes several independent server requests **in sequence**
   before showing content", and "a family that does not fit a room is hard to place … the screen
   does not make splitting or overriding easy." Verdict: not slow, but **no correct exit**.
2. **Check-in** — "staff cannot tell whether a change was saved or only queued", plus the
   wrong-morning-date issue. Verdict: **erodes trust in the data itself.**
3. **Departure planning** — slow export, but WhatsApp is a stable fallback. Verdict:
   **efficiency loss, not a hard block.**

Section 1 came out garbled (the model did not emit MiroFish's expected `Final Answer:` marker, so
raw tool-call text leaked in); sections 3–5 were not reached before the run was stopped.

---

## Setup notes / caveats (honest)

- **Model-name correction:** the API rejected `DeepSeek-V4.1-Flash`; the valid names are
  `deepseek-flash` and `deepseek-v4-pro`. Used `deepseek-flash`.
- **The OASIS run hung**, not from the vendor being down (DeepSeek answered in ~2 s) but from an
  untimed in-process LLM call; the child burned CPU then blocked. Stopped deliberately after ~18
  posts rather than waiting indefinitely.
- **Agents replied in Chinese** (MiroFish's OASIS/agent system prompts are Chinese); the findings
  above are translated. Content is unaffected.
- **This is a simulation, not a UI test.** MiroFish models agents talking in a social feed — it
  does not click EventFlow's screens. Treat these as *hypotheses a realistic user would raise*,
  which happen to match the code-level defects.
- **Security:** `.mirofish/` (with its live DeepSeek + Zep keys in `.env`) is gitignored. The keys
  were pasted in chat, so **rotate them** now that the run is done. Backend was bound to
  `127.0.0.1` with Flask debug **off** (CVE-2026-7041 is the Werkzeug debugger).
- All background processes were stopped; port 5001 is free.

## Where the data is

```
.mirofish/out/
  01-ontology.json             the 7 personas + Hotel/Person/Organization, extracted by MiroFish
  02-build-final.json          graph stats (55 nodes / 66 edges)
  04-prepare-final.json        16 profiles generated
  05-run-final.json            the run's terminal state (stopped)
  14-sim-data.json             full DB dump: 16 agents, 18 posts, 10 likes, 3 follows
  14-posts.txt                 human-readable posts (Chinese)
  sim-twitter_profiles.csv     all 16 agent personas
  sim-config.json              the LLM-generated simulation config
  report/                      the ReportAgent's outline, sections, agent log
```
