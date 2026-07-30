---
tags: [moc, session-log]
updated: 2026-07-31
---

# Sessions

Back to [[EventFlow]]. Auto-captured raw history. One note per Claude Code session.

## How this works

A hook in `.claude/settings.json` runs `.claude/hooks/capture-context.ps1`, which reads the
session transcript and writes a note here. It fires on two events:

| Event | When | Why it matters |
|---|---|---|
| `PreCompact` | just before context is summarised away | **the important one** - this is the moment knowledge would otherwise be lost on a project this size |
| `SessionEnd` | when the session closes | the final state of the session |

Both write to the **same note per session**, keyed by session id, so a note is rewritten
rather than duplicated. A session that compacts three times still produces one note,
always current.

Each note captures: every prompt asked, a table of files created or modified with edit
counts, the distinct shell commands run, and the closing narrative.

## Two layers, deliberately

> [!important] These notes are evidence, not knowledge
> Session logs are raw and unedited - they record what happened, including the wrong turns.
> The curated notes ([[Schema Reality Check]], [[Known Traps]], [[Status]]) are what the
> project actually *knows*. When something durable is learned in a session, it belongs in a
> curated note, not left buried in a log.

The same distinction the app itself makes about [[RSVP Capture Pipeline|AI output being
evidence rather than data]].

## Finding things

Obsidian search across this folder is the point - it is why the raw history is worth
keeping. Useful queries:

- `tag:#session-log <term>` - search only session history
- `path:Sessions "error"` - find where something broke
- backlinks on any curated note show which sessions touched it

## Maintenance

Notes accumulate one per session and are tracked in git. If the diffs get noisy, add
`eventflow/Sessions/` to `.gitignore` - nothing depends on them being committed.

The capture script is pure ASCII on purpose: Windows PowerShell 5.1 reads `.ps1` as ANSI
unless there is a BOM, so a stray em-dash becomes a parse error and the hook silently stops
working. Keep it that way if you edit it.
