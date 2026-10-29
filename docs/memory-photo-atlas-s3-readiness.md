# Memory Photo Atlas + S3 infrastructure readiness

Date: 2026-10-26

## Application configuration

`server.js` loads `config.env` with dotenv. It selects `DATABASE_LOCAL` only
when `NODE_ENV=development`; every other mode uses `DATABASE`. If the URI
contains `<db_password>`, the process-local `DATABASE_PASSWORD` value replaces
that placeholder. The original configuration file was not changed.

The configured Atlas database name is `king_queen_voting_v2`, which is shared
and is not suitable for destructive integration testing. Memory Photo is
configured for S3 with the explicit shared-bucket opt-in and the
`memory-photos/` prefix.

## Disposable Atlas probe

A unique name of the form
`kqv_memory_photo_it_<yyyymmdd>_<random>` was generated in process memory. A
read-only connection attempt targeted that database by replacing only the URI
path; no collection creation, seed, account, feature-control or document write
was attempted.

Result: **BLOCKED / UNVERIFIED**. Windows' configured resolver is the local
loopback resolver (`127.0.0.1`) and `nslookup` timed out for the Atlas SRV
record. Node's default resolver also timed out; switching Node to public
resolvers (`1.1.1.1`, `8.8.8.8`) timed out in this environment as well. The
driver consequently failed with `querySrv ECONNREFUSED` before authentication.
Emptiness, database ownership and Atlas user permissions could not be verified.

Required before proceeding:

1. Reliable DNS/network access to the Atlas cluster.
2. An Atlas user permitted to connect to a uniquely named test database.
3. A confirmation that the generated database is empty before initialization.
4. A disposable-database owner or cleanup authority for dropping it afterward.

## AWS inspection

The AWS CLI is unavailable. A local, no-manifest-change install of
`@aws-sdk/client-sts` was used only for read-only inspection. STS caller
identity succeeded and identified an IAM user in the configured account; no
credentials were printed.

The following checks remain **UNVERIFIED**:

- AWS caller identity and account ownership: **PASS**
- Bucket policy
- Account/bucket Block Public Access
- Object Ownership
- Bucket ACL
- Bucket versioning
- Access points and CDN/public delivery paths
- IAM scope for `memory-photos/*`
- Anonymous access denial for a newly created test object
- Safe deletion of a test object

All bucket-level configuration checks returned `AccessDenied`, so they remain
**UNVERIFIED**, not safe-by-denial. The available S3 package also could not
confirm access-point enumeration or a nonexistent-key HEAD response. Put,
Get and Delete permissions for `memory-photos/*` remain unverified because no
test object was created.

AccessDenied from an unavailable or unauthorized configuration API must not be
treated as evidence that the private prefix is safe.

## Readiness decision

**NOT READY FOR CLOUD WRITES.** Do not start production application
initialization, create Atlas accounts, enable Memory Photo, upload S3 objects,
moderate photos or create likes until Atlas connectivity/isolation and the
private S3 access path are independently verified.

The local development/private-storage workflow remains the safe test path.
