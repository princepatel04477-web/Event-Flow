---
tags: [pipeline, phase-1, important]
updated: 2026-07-31
---

# RSVP Capture Pipeline

Back to [[EventFlow]]. Tasks `p1f` → `p1i`. Guarantee #4: **AI output is evidence, not data.**

```
tel: dial → call recording (native Capacitor module) or post-call voice note
  → IndexedDB queue → Supabase Storage
  → Edge fn: STT (gu-IN + hi-IN + en-IN)
  → Edge fn: Claude → strict JSON + per-field confidence
  → REVIEW SCREEN  ← human confirms
  → apply_rsvp_extraction()   ← the only write path
  → Excel export
```

## Every stage before the review screen is inert

`call_recordings`, `transcripts`, and `rsvp_extractions` rows change **nothing** about a
guest. A transcript can be wrong, an extraction can hallucinate a flight number, and the
guest data is untouched. Only `apply_rsvp_extraction()` writes, and only a human calls it.

This is why the review screen is [[Scope Cuts|never cut]].

## Stage by stage

### 1. Dial — `p1f`

`tel:` deep link. No custom dialer.

> [!danger] Write the `call_attempts` row **before** the dial fires
> `tel:` backgrounds the browser and Android may discard page state. Keep the row id in
> `sessionStorage` and rehydrate on resume. The flow is *resume-first*, not
> *continue-first*. See [[Known Traps]].

Remember the row freezes the moment `outcome` is set — write it once, at the end. See
[[Guests and RSVP]].

### 2. Record — `p1g`

> [!warning] No browser can record a live phone call
> This is an OS-level restriction, not a coding problem. It is the entire reason a native
> Capacitor module exists. Whether it works on Android 13+ is the project's one open
> structural risk — see [[Open Questions]].

Fallback that always works: a post-call voice note. Design the UI so the fallback is not a
second-class path.

### 3. Queue and upload

IndexedDB outbox, drained when signal returns. Venue Wi-Fi will fail.

Storage path **must** be `call-recordings/{event_id}/{group_id}/{uuid}.m4a` — the first
folder segment is the tenant key, and a wrong path is a rejected upload.

### 4. Transcribe

Edge function → Sarvam Saarika or Google STT v2. Languages: `gu-IN`, `hi-IN`, `en-IN`, and
in practice all three code-mixed within one sentence.

Store provider, model and confidence on the `transcripts` row.

### 5. Extract

Edge function → Claude → strict JSON. Shape and pitfalls in [[Extraction Contract]].

> [!tip] Feed the group's existing record into the prompt
> That context is what resolves "same as last time", "do divas pehla", DD/MM ordering, and
> "saade das" → 10:30. Without it the model is guessing at ambiguity it cannot see.

Instruct the model to emit `null` rather than guess, especially on flight numbers.
**A hallucinated PNR is worse than a blank.**

### 6. Review — `p1i`

Fields below ~0.8 confidence render **amber**. Nothing auto-writes. The human edits, then
commits.

The payload sent to the RPC is **not** the shape the model emits — see
[[Extraction Contract]] for the mapping. Getting this wrong silently drops
`special_requests`.

### 7. Commit

`apply_rsvp_extraction()` — one transaction, updates the group, upserts arrival and
departure legs, marks the extraction accepted, and clears the caller lock. See
[[Views and RPCs]].

## Related

[[Guests and RSVP]] · [[Extraction Contract]] · [[Known Traps]] · [[Open Questions]]
