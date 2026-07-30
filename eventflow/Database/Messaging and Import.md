---
tags: [database, phase-5]
updated: 2026-07-31
---

# Messaging and Import

Back to [[Schema Overview]]. Migration `0400`.

## `message_templates`

Same global / per-event split as `vehicle_types` — `event_id is null` is a global template,
`event_id` set overrides it for one event. Keyed on `(key, language)`.

Body uses `{{head_name}}` style placeholders, with the expected names listed in a
`variables` jsonb array so a UI can validate before sending.

Five seeded globally in `0700`:

| key | category |
|---|---|
| `rsvp_invite` | rsvp |
| `rsvp_confirmed` | rsvp |
| `room_allocated` | rooms |
| `pickup_details` | logistics |
| `departure_details` | logistics |

[[Scope Cuts]] keeps three if time runs short: RSVP request, room + arrival confirmation,
logistics detail.

## `messages`

One row per outbound WhatsApp message. Carries `to_number`, rendered `body`, the
`template_key` used, provider (`meta_cloud` | `self_hosted`), `provider_message_id`, and a
status running `queued` → `sent` → `delivered` → `read` / `failed` with matching timestamps.

Indexed on `provider_message_id` so a delivery webhook can find its row.

> [!note] No audit trigger
> `messages` is one of the tables missing audit coverage — see [[Schema Reality Check]].

## `import_batches` and `import_rows`

The audit trail for [[Excel Import]].

`import_batches` — one row per uploaded file: `kind` (guests / rooms / rsvp / logistics),
filename, storage path, and counts for total / inserted / updated / skipped rows, plus a
status and error field.

`import_rows` — one row per spreadsheet row: `row_number`, the `raw` jsonb of the original
cells, the computed `row_hash`, a per-row status (`inserted` / `updated` / `skipped` /
`error`), and a nullable `group_id` linking to whatever it produced.

Keeping `raw` means a bad import can be diagnosed months later without the original file.

> [!note] Neither table has an audit trigger
> They *are* the audit trail, so this is fine.

## Related

[[Excel Import]] · [[Guests and RSVP]] · [[Scope Cuts]]
