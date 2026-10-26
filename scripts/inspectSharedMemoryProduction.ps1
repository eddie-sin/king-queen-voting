[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config.env')
)

$ErrorActionPreference = 'Stop'
$SharedDatabase = 'king_queen_voting_v2'
$DnsFile = Join-Path $env:USERPROFILE '.kqv-tools\public-dns.cjs'

if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Missing configuration file: $ConfigPath" }
if (-not (Test-Path -LiteralPath $DnsFile)) { throw "Missing DNS preload: $DnsFile" }

function Read-ConfigValue([string]$Name) {
  $line = Get-Content -LiteralPath $ConfigPath |
    Where-Object { $_ -match "^\s*$Name\s*=" } |
    Select-Object -Last 1
  if (-not $line) { return $null }
  $value = ($line -split '=', 2)[1].Trim()
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
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
if ($uri.Scheme -ne 'mongodb+srv') { throw 'The inspection requires a mongodb+srv Atlas URI.' }
$uriBuilder = New-Object System.UriBuilder($uri)
$uriBuilder.Path = "/$SharedDatabase"
$effectiveUri = $uriBuilder.Uri.AbsoluteUri
if ($effectiveUri -match 'king_queen_voting_v2' -and $uriBuilder.Path.Trim('/') -ne $SharedDatabase) { throw 'Safety check failed: unexpected database target.' }

$env:NODE_OPTIONS = "--require=$DnsFile"
$env:KQV_INSPECT_URI = $effectiveUri
$env:KQV_INSPECT_DB = $SharedDatabase

$probe = @'
const { MongoClient } = require('mongoose').mongo;

const required = {
  eventcontrols: ['_id_'],
  memoryphotos: ['_id_', 'owner_1_createdAt_-1', 'status_1_createdAt_-1'],
  memoryphotolikes: ['_id_', 'photoId_1_userId_1'],
  memoryphotoquotas: ['_id_'],
};

(async () => {
  const dbName = process.env.KQV_INSPECT_DB;
  const client = new MongoClient(process.env.KQV_INSPECT_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name).sort();
    const output = { database: dbName, connectivity: 'PASS', collections, eventControls: null, collectionChecks: {}, authenticationCompatibility: {} };

    if (collections.includes('eventcontrols')) {
      const controls = await db.collection('eventcontrols').findOne(
        { _id: 'event' },
        { projection: { _id: 1, schemaVersion: 1, memoryPhotosEnabled: 1, revision: 1, round: 1, window: 1 } },
      );
      output.eventControls = controls ? {
        present: true,
        schemaVersion: controls.schemaVersion ?? null,
        hasMemoryPhotosEnabled: typeof controls.memoryPhotosEnabled === 'boolean',
        hasRevision: Number.isInteger(controls.revision),
        hasRound: Number.isInteger(controls.round),
        hasWindow: Number.isInteger(controls.window),
      } : { present: false };
    } else output.eventControls = { present: false };

    for (const [name, expected] of Object.entries(required)) {
      if (!collections.includes(name)) {
        output.collectionChecks[name] = { present: false, count: null, indexes: [], missingIndexes: expected };
        continue;
      }
      const indexes = await db.collection(name).indexes();
      const names = indexes.map(index => index.name).sort();
      output.collectionChecks[name] = {
        present: true,
        count: await db.collection(name).countDocuments({}),
        indexes: indexes.map(index => ({ name: index.name, key: index.key, unique: index.unique === true })),
        missingIndexes: expected.filter(index => !names.includes(index)),
      };
    }

    for (const name of ['users', 'admins', 'studentsessions']) {
      if (!collections.includes(name)) {
        output.authenticationCompatibility[name] = { present: false, count: null };
      } else {
        const count = await db.collection(name).countDocuments({});
        const indexes = (await db.collection(name).indexes()).map(index => index.name).sort();
        output.authenticationCompatibility[name] = { present: true, count, indexes };
      }
    }

    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ connectivity: 'FAIL', code: error.code ?? null, codeName: error.codeName ?? null, error: error.name }, null, 2));
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
})();
'@

try {
  $probe | node
} finally {
  Remove-Item Env:KQV_INSPECT_URI -ErrorAction SilentlyContinue
  Remove-Item Env:KQV_INSPECT_DB -ErrorAction SilentlyContinue
}
