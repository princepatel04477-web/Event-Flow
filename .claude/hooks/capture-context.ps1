<#
  capture-context.ps1

  Claude Code hook. Reads the session transcript and writes a session note into
  the Obsidian vault at <project>/eventflow/Sessions/.

  Wired to SessionEnd and PreCompact in .claude/settings.json. PreCompact is the
  important one: it fires just before context is summarised away, which on a
  project this size is exactly when knowledge would otherwise be lost.

  Receives the hook payload as JSON on stdin. One note per session, rewritten in
  place on each fire, so the note always reflects the whole session so far.

  NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI
  unless there is a BOM, so a stray em-dash becomes a parse error.

  This must never break a session: every failure path exits 0 silently.
#>

$ErrorActionPreference = 'Stop'
$bt = [char]96   # backtick, for emitting markdown code spans

try {
  $raw = [Console]::In.ReadToEnd()
  if (-not $raw) { exit 0 }
  $payload = $raw | ConvertFrom-Json

  $transcript = $payload.transcript_path
  if (-not $transcript -or -not (Test-Path $transcript)) { exit 0 }

  $cwd = if ($payload.cwd) { $payload.cwd } else { (Get-Location).Path }
  $vault = Join-Path $cwd 'eventflow'
  if (-not (Test-Path $vault)) { exit 0 }

  $sessionsDir = Join-Path $vault 'Sessions'
  if (-not (Test-Path $sessionsDir)) {
    New-Item -ItemType Directory -Force -Path $sessionsDir | Out-Null
  }

  $event     = if ($payload.hook_event_name) { $payload.hook_event_name } else { 'unknown' }
  $sessionId = if ($payload.session_id) { $payload.session_id } else { 'nosession' }
  $shortId   = $sessionId.Substring(0, [Math]::Min(8, $sessionId.Length))

  # ---------------------------------------------------------------------------
  # Parse the transcript. Cap the line count so a very long session cannot stall
  # the hook; we keep the most recent lines, which is where the useful state is.
  # ---------------------------------------------------------------------------
  $lines = Get-Content $transcript -ErrorAction Stop
  if ($lines.Count -gt 8000) { $lines = $lines[-8000..-1] }

  $prompts   = New-Object System.Collections.ArrayList
  $assistant = New-Object System.Collections.ArrayList
  $fileOps   = @{}
  $commands  = New-Object System.Collections.ArrayList
  $firstTs   = $null
  $lastTs    = $null

  foreach ($line in $lines) {
    if (-not $line) { continue }
    try { $o = $line | ConvertFrom-Json } catch { continue }

    if ($o.timestamp) {
      if (-not $firstTs) { $firstTs = $o.timestamp }
      $lastTs = $o.timestamp
    }

    if ($o.type -eq 'user' -and $o.message -and $o.message.content -is [string]) {
      $t = $o.message.content.Trim()
      # Skip tool-result echoes, local command chrome and system reminders.
      if ($t -and
          $t -notmatch '^<(command-name|command-message|command-args|local-command|system-reminder)' -and
          $t -notmatch '^\s*<function_results') {
        [void]$prompts.Add($t)
      }
    }

    if ($o.type -eq 'assistant' -and $o.message -and $o.message.content) {
      foreach ($block in $o.message.content) {
        if ($block.type -eq 'text' -and $block.text) {
          [void]$assistant.Add($block.text.Trim())
        }
        elseif ($block.type -eq 'tool_use') {
          $name = $block.name
          $in   = $block.input
          if ($name -in @('Write', 'Edit', 'NotebookEdit') -and $in.file_path) {
            $p = $in.file_path -replace [regex]::Escape($cwd + '\'), ''
            $p = $p -replace '\\', '/'
            if ($fileOps.ContainsKey($p)) { $fileOps[$p] += 1 } else { $fileOps[$p] = 1 }
          }
          elseif ($name -in @('Bash', 'PowerShell') -and $in.command) {
            $c = ($in.command -replace '\s+', ' ').Trim()
            if ($c.Length -gt 160) { $c = $c.Substring(0, 160) + ' ...' }
            [void]$commands.Add($c)
          }
        }
      }
    }
  }

  if ($prompts.Count -eq 0 -and $fileOps.Count -eq 0) { exit 0 }

  # ---------------------------------------------------------------------------
  # Build the note
  # ---------------------------------------------------------------------------
  $started = if ($firstTs) { ([datetime]$firstTs).ToLocalTime() } else { Get-Date }
  $ended   = if ($lastTs)  { ([datetime]$lastTs).ToLocalTime()  } else { Get-Date }
  $stamp   = $started.ToString('yyyy-MM-dd HHmm')
  $noteName = "Session $stamp ($shortId)"
  $notePath = Join-Path $sessionsDir ($noteName + '.md')

  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('---')
  [void]$sb.AppendLine('tags: [session-log, auto-captured]')
  [void]$sb.AppendLine("session: $sessionId")
  [void]$sb.AppendLine("captured_by: $event")
  # Escape the colon: the current culture may use '.' as its time separator.
  [void]$sb.AppendLine("started: " + $started.ToString('yyyy-MM-dd HH\:mm'))
  [void]$sb.AppendLine("updated: " + $ended.ToString('yyyy-MM-dd HH\:mm'))
  [void]$sb.AppendLine('---')
  [void]$sb.AppendLine()
  [void]$sb.AppendLine("# $noteName")
  [void]$sb.AppendLine()
  [void]$sb.AppendLine("Auto-captured from the Claude Code transcript on $bt$event$bt.")
  [void]$sb.AppendLine('Curated project knowledge lives in [[EventFlow]]. This note is raw history.')
  [void]$sb.AppendLine()

  # --- what was asked
  [void]$sb.AppendLine('## What was asked')
  [void]$sb.AppendLine()
  foreach ($p in $prompts) {
    $one = ($p -replace '\r?\n', ' ')
    $one = ($one -replace '\s+', ' ').Trim()
    if ($one.Length -gt 400) { $one = $one.Substring(0, 400) + ' ...' }
    [void]$sb.AppendLine("- $one")
  }
  [void]$sb.AppendLine()

  # --- files touched
  if ($fileOps.Count -gt 0) {
    [void]$sb.AppendLine('## Files created or modified')
    [void]$sb.AppendLine()
    [void]$sb.AppendLine('| File | Edits |')
    [void]$sb.AppendLine('|---|---|')
    foreach ($k in ($fileOps.Keys | Sort-Object)) {
      $safe = $k -replace '\|', '\|'
      $n = $fileOps[$k]
      [void]$sb.AppendLine("| $bt$safe$bt | $n |")
    }
    [void]$sb.AppendLine()
  }

  # --- commands
  if ($commands.Count -gt 0) {
    $uniq = @($commands | Select-Object -Unique)
    [void]$sb.AppendLine("## Commands run ($($commands.Count) total, $($uniq.Count) distinct)")
    [void]$sb.AppendLine()
    [void]$sb.AppendLine('```')
    foreach ($c in ($uniq | Select-Object -Last 40)) { [void]$sb.AppendLine($c) }
    [void]$sb.AppendLine('```')
    [void]$sb.AppendLine()
  }

  # --- closing narrative
  if ($assistant.Count -gt 0) {
    [void]$sb.AppendLine('## Where it left off')
    [void]$sb.AppendLine()
    $tail = @($assistant)[-1]
    if ($tail.Length -gt 4000) { $tail = $tail.Substring(0, 4000) + "`n`n...truncated..." }
    [void]$sb.AppendLine($tail)
    [void]$sb.AppendLine()
  }

  [void]$sb.AppendLine('---')
  [void]$sb.AppendLine()
  [void]$sb.AppendLine('See also: [[Status]], [[Roadmap]], [[Known Traps]], [[Schema Reality Check]]')

  [System.IO.File]::WriteAllText($notePath, $sb.ToString())

  Write-Output (@{ systemMessage = "Context captured to vault: Sessions/$noteName.md" } | ConvertTo-Json -Compress)
  exit 0
}
catch {
  # A hook must never break the session.
  exit 0
}
