---
tags: [pipeline, phase-1, next]
updated: 2026-07-31
---

# Excel Import

Back to [[EventFlow]]. **Task `p1c` — the next thing to build.**

> [!info] Why this is first
> This is the line that turns an empty database into 238 real families. Nothing downstream
> — queue, calling, rooms, hampers — has anything to work on until it exists.

Source: `CALLING_MASTER_LIST.xlsx`. **Not currently in the repo.** Library: SheetJS.

## Guarantee #5 — re-import is idempotent

`guest_groups.source_row_hash` is unique per event via a partial index. Hash the
*identifying* cells of a row, not the whole row — otherwise a corrected remark creates a
duplicate family instead of updating one.

Running the same sheet twice changes nothing, rather than creating 238 duplicates.

Exported rows carry hidden ids so a round-trip matches instead of duplicating. See
[[Messaging and Import]] for `import_batches` / `import_rows`.

## Preview before write — never cut

> [!danger] Never write straight from the sheet
> The import must show a **preview with a warning list** before it writes anything.
> [[Scope Cuts|This is on the never-cut list.]]

The preview should distinguish: new rows, matched rows that will update, matched rows that
are unchanged, and rows that cannot be imported at all — with the reason.

## Real Excel is messy

Expect all of these, because they are all in the real sheet:

- **Merged family rows** — one visual family spanning several sheet rows
- **`"4th"` vs `"4TH"`** — inconsistent casing in grouping columns
- **Mobile numbers stored as decimals** — `9876543210` arriving as `9876543210.0`
- **`"Not Coming"` / `"Not Sure"` buried in a remarks column** — RSVP state hiding in free text
- **Blank rows** scattered through the sheet

## Mobile normalisation

Store as **10 digits, no `+91`**. Strip spaces, dashes, brackets, leading `+91`, leading
`0`, and the `.0` that Excel's number formatting leaves behind. A number that does not
reduce to 10 digits is a **warning**, not a silent drop — the family still exists, it just
cannot be called yet.

## Create a `guests` row for the family head

> [!warning] The single most likely thing to get wrong
> `client_guest_profiles` is built from `guests`, **not** `guest_groups`. An import that
> only creates groups leaves the client's screen completely blank, and the bug will not
> surface until Phase 2. See [[Known Traps]].

So each imported row produces **two** rows: the `guest_groups` row, and a `guests` row with
`is_head = true`. At most one head per group is enforced by a partial unique index.

## Column mapping

Do not hardcode column letters. Build a mapper the user confirms on upload — the sheet will
change, and a second event will have a different sheet entirely.

Minimum fields to map: group code, head name, primary mobile, alt mobile, expected pax,
side, group type, city, remarks, and whatever column signals `needs_return_gift`.

## Writing

All inserts are fenced by RLS on `event_id` — see [[Tenancy and RLS]]. The importer must
run as a staff user for the target event, and every row needs `event_id` set explicitly.

Record the batch in `import_batches` and every row in `import_rows` with its `raw` jsonb, so
a bad import can be diagnosed later without the original file.

## Definition of done

- Upload → column mapper → preview with warnings → confirm → write
- Re-running the same file reports "0 inserted, 0 updated, N skipped"
- 238 groups and 238 head guests exist afterwards
- Mobile numbers are 10 digits
- Rows that failed are listed with reasons, and the rest still imported

## Related

[[Guests and RSVP]] · [[Messaging and Import]] · [[Known Traps]] · [[Roadmap]]
