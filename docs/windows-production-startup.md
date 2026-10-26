# Windows production startup

This project uses MongoDB Atlas and AWS S3 in production mode. On this Windows
computer, the Outline VPN exposes `127.0.0.1` as Node.js's DNS server. That DNS
proxy can time out while resolving MongoDB Atlas SRV records even though Windows
PowerShell resolves them and the Atlas hosts accept connections on port 27017.

The confirmed symptom is:

```text
Server startup failed: querySrv ETIMEOUT _mongodb._tcp.<atlas-cluster>
```

Do not run production from a terminal that contains local-preview environment
variables. In particular, local values for `JWT_SECRET`, `ADMIN_USERNAME`,
`ADMIN_PASSWORD`, `MEMORY_PHOTO_STORAGE` or MongoDB can override `config.env`.
Use a fresh PowerShell window.

## One-time launcher setup

Create a DNS preload and a project-specific launcher outside the repository:

```powershell
$toolDir = Join-Path $env:USERPROFILE ".kqv-tools"
New-Item -ItemType Directory -Force $toolDir | Out-Null

$dnsFile = Join-Path $toolDir "public-dns.cjs"
'require("node:dns").setServers(["1.1.1.1","8.8.8.8"]);' |
  Set-Content -LiteralPath $dnsFile -Encoding utf8

$launcher = Join-Path $toolDir "start-production.ps1"

@'
$previousNodeOptions = $env:NODE_OPTIONS

try {
    $dnsFile = Join-Path $env:USERPROFILE ".kqv-tools\public-dns.cjs"
    $env:NODE_OPTIONS = "--require=$dnsFile"

    Set-Location "C:\UOS-13\Voting\king-queen-voting"
    npm run prod
}
finally {
    $env:NODE_OPTIONS = $previousNodeOptions
}
'@ | Set-Content -LiteralPath $launcher -Encoding utf8
```

The files contain no application credentials. The launcher applies the DNS
override only while this backend command is running and restores the previous
`NODE_OPTIONS` value afterward.

## Start the production backend

Open a fresh PowerShell window and run:

```powershell
& "$env:USERPROFILE\.kqv-tools\start-production.ps1"
```

Successful startup should report:

```text
Using cloud MongoDB
Database connection successful
Server running on port 5002 in production mode
```

Verify the API without exposing any private configuration:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5002/api/v1/settings
```

## Start the student frontend

In another PowerShell window:

```powershell
cd C:\UOS-13\Voting\king-queen-voting\frontend
$env:VOTING_API_TARGET = "http://127.0.0.1:5002"
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Private production configuration checklist

Keep values only in the untracked private environment configuration or the AWS
credential chain. Never add their values to documentation or Git.

Required configuration names include:

- `DATABASE` and, when the URI uses the placeholder, `DATABASE_PASSWORD`
- `PORT=5002`
- `JWT_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD`
- `AWS_REGION`, `AWS_S3_BUCKET`, and `AWS_MEMORY_PHOTO_BUCKET`
- `MEMORY_PHOTO_STORAGE=s3`
- `MEMORY_PHOTO_ALLOW_SHARED_BUCKET=true` only after the shared-prefix policy has
  been reviewed

The Atlas database must be the intended v2 database, the current outbound public
IP must be permitted by Atlas Network Access, and the backend AWS identity must
have only its required object permissions. Memory Photo objects remain under
`memory-photos/` and must not receive anonymous read access.

## Diagnostics

Confirm that Node is using the preload's public DNS resolvers:

```powershell
$env:NODE_OPTIONS = "--require=$env:USERPROFILE\.kqv-tools\public-dns.cjs"
node -e "const dns=require('node:dns'); console.log(dns.getServers()); dns.promises.resolveSrv('_mongodb._tcp.king-queen-voting.kwer9pc.mongodb.net').then(console.log).catch(console.error)"
Remove-Item Env:NODE_OPTIONS
```

If SRV resolution succeeds but Atlas still cannot connect, check Atlas Network
Access and TCP connectivity to each returned host on port 27017. Atlas sees the
VPN's public outbound IP, not the private `10.x.x.x` adapter address.

Stop backend and frontend processes with `Ctrl+C`.
