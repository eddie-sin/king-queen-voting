[CmdletBinding()]
param(
  [switch]$StartBackend,
  [switch]$AllowInitialized,
  [int]$Port = 5503
)

$ErrorActionPreference = 'Stop'
$TestDatabase = 'kqv_mp_1793012312039_e9048f'
$Repo = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $Repo 'config.env'
$DnsFile = Join-Path $env:USERPROFILE '.kqv-tools\public-dns.cjs'

if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Missing config.env." }
if (-not (Test-Path -LiteralPath $DnsFile)) { throw "Missing DNS preload: $DnsFile" }

function Read-ConfigValue([string]$Name) {
  $line = Get-Content -LiteralPath $ConfigPath | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
  if (-not $line) { return $null }
  $value = ($line -split '=', 2)[1].Trim()
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

$rawDatabase = Read-ConfigValue 'DATABASE'
if (-not $rawDatabase) { throw 'DATABASE is not configured.' }
if ($rawDatabase -match '/king_queen_voting_v2(?:\?|$)') { $rawDatabase = $rawDatabase -replace '/king_queen_voting_v2(?=\?|$)', "/$TestDatabase" }

# Match server.js: substitute the password in the original URI string before
# parsing it, because URL parsing would encode the placeholder characters.
$databasePassword = if ($env:DATABASE_PASSWORD) { $env:DATABASE_PASSWORD } else { Read-ConfigValue 'DATABASE_PASSWORD' }
if ($rawDatabase.Contains('<db_password>')) {
  if (-not $databasePassword) { throw 'DATABASE_PASSWORD is missing from the process environment and config.env.' }
  $rawDatabase = $rawDatabase.Replace('<db_password>', [Uri]::EscapeDataString($databasePassword))
}

try { $effectiveUri = [Uri]$rawDatabase } catch { throw 'The effective Atlas URI is invalid.' }
if ($effectiveUri.Scheme -ne 'mongodb+srv') { throw 'The test launcher requires a mongodb+srv Atlas URI.' }
if ($effectiveUri.AbsolutePath.Trim('/') -ne $TestDatabase) { throw 'Safety check failed: effective URI does not target the disposable test database.' }
if ($effectiveUri.AbsolutePath -match 'king_queen_voting_v2') { throw 'Safety check failed: shared database name detected.' }

$env:NODE_OPTIONS = "--require=$DnsFile"
$env:NODE_ENV = 'production'
$env:PORT = [string]$Port
$env:HOST = '127.0.0.1'
$env:DATABASE = $rawDatabase
$env:AWS_REGION = 'ap-southeast-1'
$env:AWS_S3_BUCKET = 'thadinkyut-voting-images-2026'
$env:AWS_MEMORY_PHOTO_BUCKET = 'thadinkyut-voting-images-2026'
$env:MEMORY_PHOTO_STORAGE = 's3'
$env:MEMORY_PHOTO_ALLOW_SHARED_BUCKET = 'true'
$env:AUTH_ORIGIN = 'http://localhost:5173'
$env:AUTH_ENVIRONMENT = 'local'
$env:ADMIN_USERNAME = if ($env:ADMIN_USERNAME) { $env:ADMIN_USERNAME } else { Read-ConfigValue 'ADMIN_USERNAME' }
$env:ADMIN_PASSWORD = if ($env:ADMIN_PASSWORD) { $env:ADMIN_PASSWORD } else { Read-ConfigValue 'ADMIN_PASSWORD' }
if (-not $env:ADMIN_USERNAME -or -not $env:ADMIN_PASSWORD) { throw 'ADMIN_USERNAME and ADMIN_PASSWORD must be supplied in the process environment or config.env.' }

function New-LocalHexSecret {
  # Windows PowerShell 5.1/.NET Framework has no static RandomNumberGenerator.Fill
  # or Convert.ToHexString; use the compatible disposable API and explicit hex.
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}
if (-not $env:JWT_SECRET) { $env:JWT_SECRET = New-LocalHexSecret }

# Prefer an explicitly supplied process value, otherwise load the existing
# local config value. Generate only the two local secrets when neither exists.
foreach ($name in @('GOOGLE_CLIENT_ID_PRODUCTION', 'RESEND_API_KEY', 'AUTH_EMAIL_FROM')) {
  if (-not (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue)) {
    $value = Read-ConfigValue $name
    if ($value) { Set-Item -Path "Env:$name" -Value $value }
  }
}
foreach ($name in @('AUTH_OTP_SECRET', 'AUTH_MAIL_SECRET')) {
  if (-not (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue)) {
    $value = Read-ConfigValue $name
    if ($value) { Set-Item -Path "Env:$name" -Value $value }
  }
  if (-not (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue)) {
    Set-Item -Path "Env:$name" -Value (New-LocalHexSecret)
  }
}
if (-not $env:GOOGLE_CLIENT_ID_PRODUCTION -or -not $env:RESEND_API_KEY) { throw 'Production auth requires GOOGLE_CLIENT_ID_PRODUCTION and RESEND_API_KEY in the process environment or config.env.' }

$probe = @'
const { MongoClient } = require('mongoose').mongo;
(async () => {
  const name = process.env.KQV_TEST_DB;
  const client = new MongoClient(process.env.KQV_TEST_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const collections = await client.db(name).listCollections({}, { nameOnly: true }).toArray();
    console.log(JSON.stringify({ empty: collections.length === 0, collectionCount: collections.length }));
  } catch (error) {
    console.log(JSON.stringify({ error: error.codeName || error.code || error.name }));
    process.exitCode = 1;
  } finally { await client.close().catch(() => {}); }
})();
'@
$env:KQV_TEST_DB = $TestDatabase
$env:KQV_TEST_URI = $rawDatabase
$probeResult = ($probe | node | ConvertFrom-Json)
Remove-Item Env:KQV_TEST_URI -ErrorAction SilentlyContinue
if ($probeResult.error) { throw "Atlas read-only guard failed: $($probeResult.error)" }
if (-not $probeResult.empty -or $probeResult.collectionCount -ne 0) {
  if (-not $AllowInitialized) {
    throw 'Safety check failed: disposable database is not empty. Use -AllowInitialized only after confirming it is this preview database.'
  }
  Write-Host "Atlas guard passed for $TestDatabase ($($probeResult.collectionCount) existing collections; exact disposable name verified)."
} else {
  Write-Host "Atlas guard passed for $TestDatabase (zero collections)."
}

if ($StartBackend) {
  $log = Join-Path $env:TEMP 'kqv-memory-production-preview.log'
  $err = Join-Path $env:TEMP 'kqv-memory-production-preview.err.log'
  Start-Process powershell -ArgumentList '-NoProfile','-Command',"Set-Location '$Repo'; npm run prod" -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden | Out-Null
  Write-Host "Backend starting on http://127.0.0.1:$Port; logs: $log"
} else {
  Write-Host 'Backend not started. Re-run with -StartBackend after reviewing the guard result.'
}

Write-Host 'Student frontend: Set-Location frontend; $env:VOTING_API_TARGET="http://127.0.0.1:'$Port'"; npm run dev -- --host 127.0.0.1'
Write-Host 'Admin frontend: Set-Location admin; $env:VOTING_API_TARGET="http://127.0.0.1:'$Port'"; npm run dev -- --host 127.0.0.1'
Write-Host 'URLs: http://127.0.0.1:5173/#memory-upload and http://127.0.0.1:5174/'
