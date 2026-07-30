---
tags: [pipeline, phase-1, ai, important]
updated: 2026-07-31
---

# Extraction Contract

Back to [[RSVP Capture Pipeline]]. Tasks `p1h` and `p1i`.

## What the model emits

```json
{
  "rsvp_status": "confirmed|declined|tentative|callback|unreachable",
  "confirmed_pax": 6,
  "arrival":   {"date":"2026-12-20","time":"10:30","mode":"air",
                "reference":"6E 5074","point":"Ahmedabad T2"},
  "departure": {"date":null,"time":null,"mode":null,"reference":null,"point":null},
  "special_requests": "wheelchair for mother",
  "language": "gu",
  "confidence": {"rsvp_status":0.95,"confirmed_pax":0.88,"arrival.date":0.71}
}
```

Store this whole object as `rsvp_extractions.parsed`, and the confidence map as
`rsvp_extractions.confidence`.

## What the RPC actually reads

> [!danger] These are not the same shape
> `apply_rsvp_extraction()` reads exactly these top-level keys and **silently ignores
> everything else**. The review screen must translate.

| RPC reads | Writes to | Note |
|---|---|---|
| `rsvp_status` | `guest_groups.rsvp_status` | cast to `app.rsvp_status` |
| `confirmed_pax` | `guest_groups.confirmed_pax` | integer |
| `side` | `guest_groups.side` | **not in the model output** — reviewer-supplied |
| `remarks` | `guest_groups.remarks` | ← **`special_requests` maps here** |
| `arrival` object | `travel_legs` where `direction = 'arrival'` | |
| `departure` object | `travel_legs` where `direction = 'departure'` | |

Leg object keys: `mode`, `date`, `time`, `reference`, `point`, **`pax`** — note it is
`pax`, not `pax_on_leg`, even though the column is `pax_on_leg`.

Ignored by the RPC: `special_requests` (unless renamed), `language`, `confidence`. Persist
those on the extraction row instead.

## Three behaviours that will surprise you

1. **`coalesce` everywhere — you cannot null a field out.** Every assignment is
   `coalesce(payload_value, existing_value)`. A reviewer who clears a wrong flight number
   and saves will find it unchanged. Supporting "clear this field" requires an RPC change.
2. **Only the oldest leg per direction is updated** — `order by created_at limit 1`. A
   group with two arrival legs will never see the second updated here.
3. **Only `accepted` blocks re-application.** A `rejected` extraction can still be applied.
   Guard that in the UI.

Empty strings are handled: the RPC uses `nullif(value, '')` before casting, so `""` is
treated as absent rather than raising a cast error.

## Prompting rules

> [!tip] Feed the group's existing record in as context
> `head_name`, `expected_pax`, current `rsvp_status`, any existing travel legs, `remarks`.
> This is what resolves "same as last time", "do divas pehla" (two days before), DD/MM vs
> MM/DD, and "saade das" → 10:30.

- Emit `null` rather than guess. **A hallucinated PNR is worse than a blank.**
- Flight numbers especially — `6E 5074` heard over a bad line is not reliable.
- Expect code-mixed Gujarati / Hindi / English inside a single sentence.
- Return per-field confidence using dotted paths (`arrival.date`) so the review screen can
  highlight sub-fields.

## Review screen rules

- Fields below ~**0.8** confidence render **amber**
- Nothing auto-writes, ever
- Show the transcript alongside the extracted fields so the reviewer can check a claim
- On commit, translate to the RPC payload shape above — this is where `special_requests`
  becomes `remarks`

## Related

[[RSVP Capture Pipeline]] · [[Views and RPCs]] · [[Schema Reality Check]] · [[Guests and RSVP]]
