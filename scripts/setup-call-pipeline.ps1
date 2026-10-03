# EventFlow call pipeline setup. Run ONCE from C:\dev\EventFlow:
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-call-pipeline.ps1
#
# What it does:
#   1. Asks for your Sarvam and Anthropic keys (typed hidden, never saved to disk
#      after this script ends, never printed).
#   2. Generates two random webhook secrets.
#   3. Sets all four as Supabase Edge Function secrets.
#   4. Deploys transcribe-recording and extract-rsvp.
#   5. Copies the matching Vault SQL to your clipboard and opens the SQL Editor.
#      Paste it, press Run. That is the last step.
#
# Safe to re-run: it rotates the webhook secrets in both places together.
# Needs `npx supabase login` to have been done once on this machine.

$ErrorActionPreference = 'Stop'
$ref = 'xktxnkuzplhzxkevwrcj'
$base = "https://$ref.supabase.co/functions/v1"

function New-Secret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Read-Hidden([string]$prompt) {
  $secure = Read-Host -AsSecureString $prompt
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

if (-not (Test-Path 'supabase\functions\transcribe-recording\index.ts')) {
  throw 'Run this from the repo root, C:\dev\EventFlow'
}

$sarvam = Read-Hidden 'Sarvam API key'
if (-not $sarvam) { throw 'A Sarvam key is required' }
$anthropic = Read-Hidden 'Anthropic API key (Enter to skip; extraction will not run until it is set)'

$transcribeSecret = New-Secret
$extractSecret = New-Secret

# Secrets go through a temp env file, not the command line, so they never land
# in shell history or a process listing. The file is deleted straight after.
$envFile = Join-Path $env:TEMP ("ef-secrets-" + [guid]::NewGuid().ToString('N') + '.env')
try {
  $lines = @(
    "SARVAM_API_KEY=$sarvam",
    "TRANSCRIBE_WEBHOOK_SECRET=$transcribeSecret",
    "EXTRACT_WEBHOOK_SECRET=$extractSecret"
  )
  if ($anthropic) { $lines += "ANTHROPIC_API_KEY=$anthropic" }
  [IO.File]::WriteAllLines($envFile, $lines)

  Write-Host 'Setting Edge Function secrets...'
  npx supabase secrets set --project-ref $ref --env-file $envFile
  if ($LASTEXITCODE -ne 0) { throw 'secrets set failed. Run: npx supabase login   then run this script again.' }
}
finally {
  if (Test-Path $envFile) { Remove-Item $envFile -Force }
}

foreach ($fn in 'transcribe-recording', 'extract-rsvp') {
  Write-Host "Deploying $fn..."
  npx supabase functions deploy $fn --project-ref $ref --no-verify-jwt
  if ($LASTEXITCODE -ne 0) { throw "deploy of $fn failed" }
}

$sql = @"
-- EventFlow call pipeline: webhook secrets for the database triggers.
-- Paste into Supabase > SQL Editor and press Run. Safe to run again.
do `$`$
declare
  r record;
begin
  for r in
    select * from (values
      ('transcribe_webhook_url',    '$base/transcribe-recording'),
      ('transcribe_webhook_secret', '$transcribeSecret'),
      ('extract_webhook_url',       '$base/extract-rsvp'),
      ('extract_webhook_secret',    '$extractSecret')
    ) as v(name, val)
  loop
    if exists (select 1 from vault.secrets where name = r.name) then
      perform vault.update_secret((select id from vault.secrets where name = r.name), r.val);
    else
      perform vault.create_secret(r.val, r.name);
    end if;
  end loop;
end
`$`$;

select name from vault.secrets
 where name in ('transcribe_webhook_url','transcribe_webhook_secret','extract_webhook_url','extract_webhook_secret')
 order by name;
"@

Set-Clipboard -Value $sql
Start-Process "https://supabase.com/dashboard/project/$ref/sql/new"

Write-Host ''
Write-Host 'Done with the command line part.'
Write-Host 'LAST STEP: the SQL Editor just opened. Paste (Ctrl+V) and press Run.'
Write-Host 'You should see 4 rows: the four secret names.'
if (-not $anthropic) { Write-Host 'Note: no Anthropic key was set, so transcripts will not be turned into call notes yet.' }
