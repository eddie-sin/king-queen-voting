# Memory Photo pre-merge review — 2026-10-21

> Historical snapshot below. The subsequent durable cancellation fix resolves
> H1 with same-ID fencing, fail-closed cleanup and database-backed recovery;
> see [submission safety and recovery](memory-photo-submissions.md). The current
> regression suite passes 119 tests. Latest-main integration remains deferred;
> the old decision, Git state and commands below describe the original review,
> not the current staging/commit preparation. Generated JSON execution/review
> reports remain local and are excluded from commits.

**Decision: NOT READY.** Ordinary regression behavior passes, but latest-main
integration and ambiguous-write quota safety must be resolved before merging.
No merge, rebase, commit, push, branch deletion, cloud request or forced audit fix
was performed during this review.

## Git state and merge compatibility

`feature/memory-photo`, local `main`, and HEAD still point at
`503f1de41cd74e47062c436103c4b9603114aa82`. All Memory Photo changes are in the
working tree, including untracked source/tests/docs/Postman artifacts; a merge
of the current branch ref alone would carry none of this work.

Fetched `origin/main` is `bf7eca357e865a0431ad0551c0e604ec1f62588d`, eleven commits
ahead. Read-only per-file three-way simulations used main as the base, the
working file as the feature version, and origin/main as the incoming version.
Text was normalized to LF to match this repository's `core.autocrlf=true`.

Conflicts were detected in **app.js, utils/s3.js and utils/seed.js**. Other
overlapping files (.gitignore, model/electionModel.js, package.json and
test/api.test.js) merged textually in simulation; this does not prove semantic
compatibility or replace a complete post-integration test run.

When reconciling, preserve the upstream wishes router and Wish index startup,
the feature's Memory Photo router/like index/Admin role initialization, and the
upstream S3 public URL/key lookup/deletion helpers alongside private S3 helpers.
Upstream also adds candidate photo-layout/edit/delete behavior, lantern metadata,
wish-sky code, and admin/frontend applications. Do not resolve conflicts by
replacing whole files with one side. Regenerate/validate the lockfile as needed
and run the combined backend and new frontend/admin test suites afterwards.

## Findings by severity

### Critical

None found in the reviewed working tree. No claim is made that a heuristic
secret scan or unit suite proves the absence of all security defects.

### High — H1: ambiguous insert can outlive upload rollback

In [controller/memoryPhotosController.js](../controller/memoryPhotosController.js),
lines 39–54 treat an acknowledged compensating delete as sufficient to release
the reservation, even when the original save failed ambiguously. A delete that
finds no document does not fence a still-running original insert.

An isolated fault-injection test modeled this ordering:

1. Reserve a photo ID and store its private file.
2. The save reports an ambiguous error before its insert is visible.
3. Compensating delete acknowledges zero matches; file is deleted and slot freed.
4. The original insert completes late using its reserved ID.
5. Three further requests are accepted.

Observed outcome: **four MemoryPhoto documents with three quota slots**, including
a late PENDING record whose file was already removed. The test deliberately
injected the late write; it did not reproduce an actual driver/network timeout.
Normal explicit failures and commit-before-error cases remain covered and pass.
This exposes a missing guarantee in the compensation design under the modeled
ambiguous outcome, rather than a failure of the atomic three-slot reservation.

Resolve with a reviewed fencing/commit/reconciliation policy (or a suitable
transactional persistence design). A failed/uncertain write must not be able to
materialize an unaccounted photo after its reservation is released. Automatically
expiring reservations is not a safe fix. This is not changed in a cleanup-only
task because it changes failure semantics and needs new regression coverage.

### High — H2: current feature cannot be safely merged as-is

The feature is entirely uncommitted and is behind remote main with the three
conflicts listed above. Current tests validate the working tree against the old
base, not the combination with upstream candidate/lantern/wish/UI changes.
Commit only reviewed files after resolving H1; then integrate latest main and
rerun the combined tests. No such integration was attempted here.

### High (development scope) — H3: existing dependency advisory

`npm audit --json --ignore-scripts` reports three high entries in the single
development dependency chain nodemon 3.1.14 → chokidar 3.6.0 → braces 3.0.3.
The advisory is [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
stack exhaustion from deeply nested brace patterns. These exact versions already
exist on the old main base; Sharp did not introduce this chain.

`npm audit --omit=dev --json --ignore-scripts` reports **zero production
vulnerabilities**. npm's proposed fix downgrades nodemon to 1.14.10 and is marked
semver-major; no automatic fix or downgrade was applied. Assess a supported
watcher/dependency remediation separately, use production startup without the
development watcher, and do not treat production-clean output as a clean full
audit. The audit is time-specific, not a lifetime vulnerability guarantee.
These are root backend audits. The newer upstream frontend/admin dependency
trees are not in this checkout and must be audited/tested after integration.

### Medium — operational and deployment limitations

- In-flight like requests can overlap a feature disable because the check and
  mutation are separate operations. Images already delivered cannot be revoked;
  requests and slow storage reads otherwise recheck visibility conservatively.
- Crashes/failed cleanup can retain reservations or orphan objects. A controlled
  recovery procedure is documented; automated reconciliation is not implemented.
- Multipart files and Sharp decoding are in memory (5 MB/25 million pixels per
  input). There is no request throttling or global decode concurrency limit;
  validation currently happens before quota admission. Apply deployment limits.
- Pending admin listing is unbounded. Public listing is bounded but offset
  pagination can shift with concurrent approvals; counts are read-time values.
- Live private S3 access is **deferred and unverified**, not a local test failure.
  Deployment must satisfy the private bucket/IAM/no-public-policy requirements in
  [memory-photo-storage.md](memory-photo-storage.md) before enabling the feature.

### Low — maintainability and environment boundaries

- Admin/public byte delivery and feature-check helpers have modest duplication.
  Their differing authorization/caching behavior is explicit; no large refactor
  was introduced during cleanup.
- Status/owner indexes support current filters. Adding `_id` to status/date sort
  coverage may help at scale; current pagination is capped at 50 rows per page.
- Sharp requires Node >=20.9.0 and a compatible native binary/libvips platform.
  Record/pin the deployment runtime before rollout; no engines restriction was
  added that might unexpectedly break existing installs.
- Existing anonymous endpoints remain public for both admin roles. MEMORY_ADMIN
  gets no additional settings/candidate/results privilege from those endpoints.

## Cleanup performed

- Kept canonical collection JSON, blank environment template, fixture and both
  sanitized integration reports (76 requests/219 assertions from prior runs).
- Preserved existing local Postman values by moving the original template to
  `postman/Memory-Photo.local.private.postman_environment.json` **without reading
  its contents**; restored a genuinely blank shareable template. The private
  backup and local/synced `.postman/`, collections, documents, environments,
  flows, globals, mocks and specs directories are now ignored, not deleted.
- `config.env` remains ignored and was never opened. No credential files are
  tracked. Generated runtime passwords/tokens were not written to artifacts.
- Startup regression children now resolve server.js absolutely and run from a
  temporary cwd, preventing dotenv from reading a developer's config.env. This
  changes test isolation, not server behavior. Fixed the adjacent indentation.
- Corrected stale README/storage wording and documented private S3 as deferred.
  No routes, permissions, quotas, moderation, liking or image behavior changed.
- Removed review helper scripts and temporary merge/fault-injection files.

## Checks and evidence

| Check | Result |
| --- | --- |
| Complete automated backend suite after test isolation cleanup | 111 passed, 0 failed |
| Fault injection of late insert after compensation | Reproduced 4 records / 3 slots; H1 |
| Node syntax checks | 58 JavaScript files, 0 failures |
| ESLint no-unused-vars, CommonJS/ES2022 | Exit 0, no findings |
| Canonical Postman JSON/scripts | 76 requests, 135 scripts parse |
| Targeted JWT/private-key/AWS-key/credential-URI heuristic scan | 0 findings in reviewed nonsecret artifacts |
| Credential staging protection | config.env/private Postman state ignored; no tracked environment credentials |
| git diff --check | Passed |
| Full npm audit | 3 high, development-only chain; exit 1 |
| Production-only npm audit | 0 findings; exit 0 |
| AWS calls | None; SDK storage tests use mocks |

Only generic operational error logs remain in Memory Photo paths. Existing
server.js startup console logs are purposeful, not leftover debug logging.
No unused imports were reported by the targeted lint rule. The full Postman
workflow was not rerun during this cleanup; prior evidence is retained with its
original run date. Detailed structural checks are retained locally in
`docs/memory-photo-premerge-checks.json` (excluded from commits).

## Recommended next commands (not executed)

First resolve H1 with a focused fix/test; review every intended file and keep the
private environment backup ignored. Then:

```powershell
git diff --check
git status --short
# Stage only explicitly reviewed source/tests/docs and canonical Postman files.
git add -- .gitignore README.md app.js controller middleware model route utils test docs package.json package-lock.json postman/Memory-Photo.postman_collection.json postman/Memory-Photo.local.postman_environment.json postman/Memory-Photo.integration-results.json postman/Memory-Photo.development-results.json postman/fixtures/memory-photo.png
git diff --cached --stat
git diff --cached
git commit -m "Add Memory Photo backend and role-based moderation"
git fetch origin
git rebase origin/main
# Resolve the reported overlaps, preserving both features, then:
$env:MONGOD_BINARY = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe'
npm test
npm audit
npm audit --omit=dev
```

Reinspect generated artifacts after resolving upstream changes. No push or merge
command is recommended until blockers and combined regression coverage are resolved.
