# Handset test — the twenty minutes a machine cannot replace

`e2e/obvious.spec.ts` measures whether a task **can** be done and how many taps it costs.
It cannot measure whether the person holding the phone **knew what to do**. That is this
page, and it is the only test in the project that needs a human being.

## How to run it

1. Hand the phone to somebody who has **never seen this app** — a family member, a
   colleague from another team, anyone who is not you. Not a staff member who has watched
   you build it: they will read the screen the way you do, which is the failure mode this
   test exists to find.
2. **Say nothing.** Not the app's name, not what a button does, not "tap the top one".
   Answer a direct question if they ask one, and then write the question down.
3. **Write down every question they ask.** Every single one. A question is a bug in the
   screen, not in them — the screen was supposed to answer it and did not.
4. One stopwatch per task. Start it when they touch the phone, stop it when the task's
   result is on screen. A task that could not be finished is recorded as such, with the
   stopwatch reading at the moment they gave up.
5. **Write nothing in the "Felt obvious?" column unless you watched it happen.** A guess
   here is worse than a blank.

## Before you start

- A **returning** phone, not a fresh install. Clear the app's data first, then open it, tap
  **Skip** on the first-run cards, and close it. That is the state a runner is in on day two,
  and it is the state the tap budgets are about. (A fresh device measures the onboarding
  cards instead of the task — exactly the trap `e2e/v12-taps.mjs` documents.)
- **The event matters.** Set `E2E_EVENT_ID` to the event `E2E_TEAM_CODE` actually signs into
  (see DECISIONS.md, V12: the two name different events in this environment). Measuring the
  wrong one produces a screen nobody can open and a report full of "element not found".
- One hand. A phone held in one hand is the real posture: the other hand is holding a
  hamper, a pen, or a door.
- Signal on, then the same run again with signal off, for tasks 3 onwards. Wi-Fi at a venue
  is not a stable condition, and the difference between "it worked" and "it worked with no
  bars" is the whole reason the offline states exist.

## The nine tasks

The same nine the automated suite runs, in the same order, in the same words.

| # | Say this, exactly | Stopwatch | Did they finish? | Felt obvious? | Questions they asked |
|---|---|---|---|---|---|
| 1 | "Call the next family who needs calling." | ______ s | yes / no | yes / no | |
| 2 | "Now write down what happened on that call." | ______ s | yes / no | yes / no | |
| 3 | "Find the family Sharma." | ______ s | yes / no | yes / no | |
| 4 | "Give a family a room." | ______ s | yes / no | yes / no | |
| 5 | "Mark a hamper delivered — take the photo." | ______ s | yes / no | yes / no | |
| 6 | "You have changed your mind about the room. Undo it." | ______ s | yes / no | yes / no | |
| 7 | "The Iyers have just walked in. Mark them arrived." | ______ s | yes / no | yes / no | |
| 8 | *(client login)* "What room is your family in?" | ______ s | yes / no | yes / no | |
| 9 | *(client login)* "Who is arriving today?" | ______ s | yes / no | yes / no | |

## Task by task — what to watch for

**1. Call the next family.** Does the phone start dialling, or does the person tap the name
and wait? A second tap before the dialler opens is the T1 failure — the screen did not
acknowledge the touch, so they touched it again.

**2. Log the outcome.** Watch whether they look for a *Save* button. There is none on this
path, and a person hunting for one will find the note about the call record being frozen
instead, which reads like a warning rather than an instruction.

**3. Find Sharma.** The search box is in the header, above the page title. If they scroll
the list looking for the name, the search is invisible to them, and that is a bug in the
header rather than in the list.

**4. Give a family a room.** Two steps: the family, then the room. Watch which one they try
first. If they try to pick a room first, the screen is arguing with how the job is actually
done — a coordinator in a lobby knows the family, not the room number.

**5. Hamper with a photo.** The photo cannot be changed or deleted after it is confirmed —
`delivery_proofs` has no update or delete policy at all. Watch whether they read the line
that says so *before* they tap Confirm, or discover it afterwards. Note the exact second
where they hesitated.

**6. Undo.** The offer lives for seven seconds. Time it. If they miss it, ask what they
expected to happen, and write that down — a person who thinks the room is unassigned when
it is not will place the same family twice.

**7. Mark arrived.** Same shape as task 4. Watch whether they find the right family: the
screen shows the next family in, and a person at a door is looking for a *name*, not for a
time.

**8. My room (client).** The client has one screen and a search box. If the answer is not
there, the screen is missing the column, not the search.

**9. Arriving today (client).** Expected to fail today: there is no arrivals screen on a
client's phone. Note what they did when they could not find it — the guess they made is
what the screen should have been.

## The outage column

Wi-Fi drops at a venue. The one action that makes a drop worse is a reload: in remote-shell
mode the app is fetched from the network on every load, so a reload during an outage lands
on `offline.html` with nothing behind it and the app is unreachable until signal returns.
The behaviour is not instinctive and the only defence is the training line.

Run tasks 3, 6 and 7 again with the phone in airplane mode. For each, record:

| Task | Did they reload / press back? | What the screen said | What they said out loud |
|---|---|---|---|
| 3 Find Sharma (offline) | reload / back / neither | | |
| 6 Undo (offline) | reload / back / neither | | |
| 7 Mark arrived (offline) | reload / back / neither | | |

**A reload during an outage is a training failure, not a product failure** — but write it
down anyway, because if three of five testers reload, the sentence in `docs/HANDSET-TEST.md`
and the offline banner are not doing their job, and the fix is copy rather than code.

The line staff must be able to repeat, in these words:

> **If the app stops responding, don't reload and don't press back. Wait.** Whatever is on
> your screen still works, and anything you already saved will send itself when the signal
> comes back. Reloading loses the screen you are on.

## What to do with the answers

- **A question asked by two people is a bug.** One person can be unlucky; two people asking
  the same thing is the screen.
- **A task that took more than 30 seconds is a bug even if they finished it.** The tap
  budgets in `e2e/obvious.spec.ts` are the machine's version of this; the stopwatch is the
  human one, and they disagree usefully.
- **"I didn't see that" is the most valuable sentence on this page.** Write it down verbatim.
- File each one against the screen it happened on, not against the app. "The room picker
  does not say which hotel" is actionable; "the app is confusing" is not.
- **Do not fix anything during the session.** Five testers in a row on an unchanged build is
  the data; a build that changes halfway through measures the build, not the screen.
