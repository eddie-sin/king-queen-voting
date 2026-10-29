[CmdletBinding()]
param(
  [switch]$StartBackend,
  [switch]$AcknowledgeSharedWrites,
  [int]$Port = 5504
)

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $Repo 'config.env'
$SharedDatabase = 'king_queen_voting_v2'
$DnsFile = Join-Path $env:USERPROFILE '.kqv-tools\public-dns.cjs'

if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Missing config.env: $ConfigPath" }
if (-not (Test-Path -LiteralPath $DnsFile)) { throw "Missing DNS preload: $DnsFile" }

function Read-ConfigValue([string]$Name) {
  $line = Get-Content -LiteralPath $ConfigPath | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
  if (-not $line) { return $null }
  $value = ($line -split '=', 2)[1].Trim()
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
  return $value
}

$raw = Read-ConfigValue 'DATABASE'
if (-not $raw) { throw 'DATABASE is not configured.' }
$password = if ($env:DATABASE_PASSWORD) { $env:DATABASE_PASSWORD } else { Read-ConfigValue 'DATABASE_PASSWORD' }
if ($raw.Contains('<db_password>')) {
  if (-not $password) { throw 'DATABASE_PASSWORD is required but was not found.' }
  $raw = $raw.Replace('<db_password>', [Uri]::EscapeDataString($password))
}
$uri = [Uri]$raw
if ($uri.Scheme -ne 'mongodb+srv') { throw 'Shared production launcher requires a mongodb+srv Atlas URI.' }
$builder = New-Object System.UriBuilder($uri)
$builder.Path = "/$SharedDatabase"
$effective = $builder.Uri.AbsoluteUri
if ($builder.Path.Trim('/') -ne $SharedDatabase) { throw 'Safety check failed: unexpected shared database target.' }
if ($builder.Path -match 'kqv_mp_1793012312039_e9048f') { throw 'Safety check failed: isolated preview database detected.' }

$env:NODE_OPTIONS = "--require=$DnsFile"
$env:NODE_ENV = 'production'
$env:PORT = [string]$Port
$env:HOST = '127.0.0.1'
$env:DATABASE = $raw
$env:AWS_REGION = 'ap-southeast-1'
$env:AWS_S3_BUCKET = 'thadinkyut-voting-images-2026'
$env:AWS_MEMORY_PHOTO_BUCKET = 'thadinkyut-voting-images-2026'
$env:MEMORY_PHOTO_STORAGE = 's3'
$env:MEMORY_PHOTO_ALLOW_SHARED_BUCKET = 'true'
$env:AUTH_ORIGIN = 'http://localhost:5173'
$env:AUTH_ENVIRONMENT = 'local'

Write-Warning "This launcher targets shared Atlas database $SharedDatabase."
Write-Warning 'server.js runs seed() at startup; seed may create indexes/admin state and close open controls.'
Write-Warning 'Run the read-only inspector first and obtain Eddie approval before starting.'

if (-not $StartBackend) {
  Write-Host 'Readiness only: backend was not started.'
  Write-Host 'Run .\scripts\inspectSharedMemoryProduction.ps1 before any approved shared startup.'
  exit 0
}
if (-not $AcknowledgeSharedWrites) {
  throw 'Refusing to start against shared data. Re-run with -AcknowledgeSharedWrites only after Eddie approves the startup effects.'
}
if (-not $env:ADMIN_USERNAME) { $env:ADMIN_USERNAME = Read-ConfigValue 'ADMIN_USERNAME' }
if (-not $env:ADMIN_PASSWORD) { $env:ADMIN_PASSWORD = Read-ConfigValue 'ADMIN_PASSWORD' }
if (-not $env:ADMIN_USERNAME -or -not $env:ADMIN_PASSWORD) { throw 'ADMIN_USERNAME and ADMIN_PASSWORD must be available through protected local configuration.' }

Write-Host "Starting approved shared backend on http://127.0.0.1:$Port"
npm run prod
