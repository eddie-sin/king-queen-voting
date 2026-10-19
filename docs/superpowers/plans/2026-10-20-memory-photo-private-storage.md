# Memory Photo Phase 2 Private Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested private storage layer that normalizes Memory Photos to static WebP, stores them under opaque keys in private S3 or private local storage, safely coordinates Phase 1 reservations, and reports possible orphans without deleting them.

**Architecture:** A storage-object registry binds opaque object keys to trusted server-side reservation fingerprints. Provider-neutral storage modules implement private local and S3 behavior, while a submission coordinator owns reserve → allocate → upload → complete and resolves ambiguous completion outcomes through authoritative MongoDB rereads. Orphan inspection is manual and dry-run-only.

**Phase 2.1 remediation:** The coordinator uses a fresh injectable clock at reservation-sensitive boundaries, acquires the Phase 1 token-fenced release/restore operation before compensation deletion, and treats storage-provider and registry-persistence outcomes separately. Reconciliation and dry-run inspection cover aged `allocated`, `uploaded`, `uncertain`, and `orphan_candidate` records. Private local roots are checked against effective public roots and filesystem links; provider errors are returned through stable redacted codes.

**Phase 2.3 remediation:** Submission no longer accepts a request-time `now`; all reservation-sensitive timestamps come from the service clock. Registry rows add timestamped `compensating` and terminal `deleted` lifecycle handling. Exact-state atomic transitions are checked before reporting completion. Manual dry-run inspection and reconciliation recover aged compensation crashes by restoring referenced matching objects to `committed`, marking verified-absent unreferenced objects `deleted`, or marking old verified unreferenced objects `orphan_candidate` without issuing storage deletion.

**Tech Stack:** Node.js 24/CommonJS, Mongoose 9, MongoDB standalone, AWS SDK v3, `@aws-sdk/s3-request-presigner`, Sharp, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-20-memory-photo-private-storage-design.md`

## Global constraints

- Work only on `feat/memory-photo-phase1`; preserve all Phase 1 behavior and tests.
- Do not add routes, controllers, frontend work, moderation, likes, or scheduled cleanup.
- Do not modify existing candidate/gallery storage, public URLs, `utils/s3.js`, `utils/imageStorage.js`, `middleware/upload.js`, or `app.js`.
- Do not access real AWS services or production/remote MongoDB in tests.
- Do not create AWS resources, run migrations, deploy, commit, push, or merge.
- Use a separate private bucket, SSE-S3, Block Public Access, and BucketOwnerEnforced; infrastructure creation is documentation-only in Phase 2.
- Store opaque keys only. Never place owner IDs, photo IDs, reservation tokens/fingerprints, filenames, or moderation data in keys, S3 metadata, signed URL response fields, or logs.
- Accept decoded JPEG, PNG, and WebP up to 5 MiB; reject HEIC/HEIF explicitly; output one static WebP up to 5 MiB and 16 megapixels, with maximum width and height of 8192 pixels.
- Presigned GET TTL defaults to 300 seconds and is constrained to 60–900 seconds.
- Orphan grace defaults to 48 hours. Inspection is explicit and dry-run-only; referenced or uncertain objects are never deleted.
- No referenced historical object is automatically deleted. Post-event photo/account retention remains unresolved.

## Dependency and configuration decisions

- Add `sharp@^0.35.5`; npm metadata declares Node `>=20.9.0`, compatible with the observed Node `v24.20.0`. Before installation, verify the implementation host/production target is supported by Sharp's prebuilt binaries or documented build prerequisites.
- Add `@aws-sdk/s3-request-presigner@^3.1153.0`; npm metadata declares Node `>=20.0.0`. Keep existing `@aws-sdk/client-s3` unless npm resolution proves the two packages require alignment; report before broadening the dependency update.
- Add only names and descriptions to `config.example.env`. Never add credentials or real values.
- Define a Phase 2 maximum reservation duration of 30 minutes and clock-skew allowance of 5 minutes at the coordinator boundary. Validate that the 48-hour grace exceeds their sum. This does not change Phase 1's reusable quota API; callers through the Phase 2 coordinator cannot exceed the new maximum.

## Review focus

- A MongoDB completion that succeeds before its response is lost must be recovered as success and must not delete the object or release the reservation (Task 6).
- Retrying one upload attempt must reuse its allocated key and checksum, while a different image for the same allocation must fail closed (Tasks 3 and 5).
- A key may be absent from the current photo but present in moderation history; both compensation and orphan inspection must protect it (Tasks 6 and 7).
- Active reservations and uncertain completion records have no committed current key yet but must still protect their uploaded objects (Task 7).
- Sharp input can satisfy byte limits while exceeding pixel/dimension limits or containing animation/metadata; decoding must reject or normalize it safely (Task 2).

---

## File map

**Create:**

- `model/memoryPhotoStorageObjectsModel.js` — internal upload/object registry and indexes.
- `utils/memoryPhotoStorageConfig.js` — validated environment/config constants.
- `utils/memoryPhotoImage.js` — signature-aware Sharp decoding and static WebP normalization.
- `utils/memoryPhotoLocalStorage.js` — private filesystem provider and local read grants.
- `utils/memoryPhotoS3.js` — private S3 provider and presigned GET grants.
- `utils/memoryPhotoStorage.js` — provider-neutral façade, opaque allocation, and registry-backed deletion checks.
- `service/memoryPhotoSubmission.js` — quota/storage/completion coordinator and uncertain-outcome reconciliation.
- `service/memoryPhotoStorageCleanup.js` — manual dry-run orphan inspection only.
- `test/memoryPhotoStorage.test.js` — focused model, image, provider, coordinator, and inspection tests.

**Modify:**

- `package.json`, `package-lock.json` — approved Sharp and presigner dependencies.
- `config.example.env` — environment variable names and descriptions only.
- `README.md` — private Memory Photo storage setup and safety boundary.

**Do not modify:** Phase 1 models/quota service, existing storage helpers, middleware, routes/controllers, app wiring, or frontends.

### Task 1: Pin dependencies and validate storage configuration

**Files:**
- Create: `utils/memoryPhotoStorageConfig.js`
- Create/Test: `test/memoryPhotoStorage.test.js`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `loadMemoryPhotoStorageConfig(env)` returning frozen `{ driver, bucket, region, prefix, localDirectory, localSigningSecret, fingerprintSecret, signedUrlTtlSeconds, orphanGraceMs, maxInputBytes, maxOutputBytes, maxPixels, maxWidth, maxHeight, maxReservationMs, clockSkewMs }`.
- Fixed defaults: prefix `memory-photos/v1/`, TTL 300 seconds, grace 48 hours, input/output 5 MiB, 16 megapixels, width/height 8192, max reservation 30 minutes, skew 5 minutes.

- [ ] **Step 1: Write failing configuration tests**

Add tests asserting fixed defaults, TTL rejection outside 60–900, grace rejection unless greater than maximum reservation plus skew, absolute private local directory validation, `local`/`s3` driver validation, and production S3 failure when bucket/region are absent. Assert local root cannot equal or be inside `uploads/`.

- [ ] **Step 2: Run the focused tests and verify they fail because the module is absent**

Run: `node --test --test-name-pattern="Memory Photo storage config" test/memoryPhotoStorage.test.js`

- [ ] **Step 3: Add dependencies without unrelated upgrades**

Run the approved install command for `sharp@^0.35.5` and `@aws-sdk/s3-request-presigner@^3.1153.0`; inspect the lockfile diff and stop if it upgrades unrelated top-level dependencies or reports platform incompatibility.

- [ ] **Step 4: Implement configuration validation**

Read environment names listed in the spec, normalize the fixed prefix internally, validate numeric bounds, and return stable non-secret configuration errors. Never read existing public `AWS_S3_BUCKET` or `AWS_S3_PUBLIC_URL` as fallback.

- [ ] **Step 5: Run tests and syntax checks**

Run: `node --test --test-name-pattern="Memory Photo storage config" test/memoryPhotoStorage.test.js`

Run: `node --check utils/memoryPhotoStorageConfig.js`

Expected: all matching tests pass.

### Task 2: Decode and normalize images safely

**Files:**
- Create: `utils/memoryPhotoImage.js`
- Modify/Test: `test/memoryPhotoStorage.test.js`

**Interfaces:**
- Consumes: limits from `loadMemoryPhotoStorageConfig`.
- Produces: `normalizeMemoryPhoto(file, options?) -> Promise<{ buffer, contentType: "image/webp", extension: "webp", byteLength, width, height, sha256 }>`.
- Produces stable errors: `MEMORY_PHOTO_IMAGE_TOO_LARGE`, `MEMORY_PHOTO_DIMENSIONS_TOO_LARGE`, `MEMORY_PHOTO_UNSUPPORTED_HEIC`, `MEMORY_PHOTO_UNSUPPORTED_FORMAT`, `MEMORY_PHOTO_ANIMATED_NOT_ALLOWED`, `MEMORY_PHOTO_INVALID_IMAGE`, and `MEMORY_PHOTO_OUTPUT_TOO_LARGE`.

- [ ] **Step 1: Write failing normalization tests**

Test valid JPEG/PNG/WebP inputs; MIME/extension disagreement; HTML, corrupt, and truncated bytes; HEIC `ftyp` signature; animated/multipage input; input/output byte bounds; 16-megapixel and 8192 width/height bounds; orientation normalization; transparency; and EXIF/GPS/XMP removal. Assert every success is one static WebP and its SHA-256 matches the output bytes.

- [ ] **Step 2: Run normalization tests and verify failure**

Run: `node --test --test-name-pattern="Memory Photo image" test/memoryPhotoStorage.test.js`

- [ ] **Step 3: Implement `normalizeMemoryPhoto` with Sharp**

Use fail-on-error decoding, page-count checks, decoded metadata checks before full output allocation, auto-orientation, single-frame WebP encoding, no metadata preservation, and post-encode byte/dimension verification. Do not infer validity from Multer MIME type.

- [ ] **Step 4: Run focused tests and syntax check**

Run: `node --test --test-name-pattern="Memory Photo image" test/memoryPhotoStorage.test.js`

Run: `node --check utils/memoryPhotoImage.js`

Expected: all matching tests pass.

### Task 3: Add the trusted storage-object registry and opaque allocation

**Files:**
- Create: `model/memoryPhotoStorageObjectsModel.js`
- Create: initial allocation functions in `utils/memoryPhotoStorage.js`
- Modify/Test: `test/memoryPhotoStorage.test.js`

**Interfaces:**
- Registry fields: `storageKey`, `uploadId`, `photoId`, `ownerId`, `reservationFingerprint`, `reservationExpiresAt`, `sha256`, `contentType`, `byteLength`, `width`, `height`, `state`, `uncertainSince`, and timestamps.
- Unique indexes: `{ storageKey: 1 }`, `{ uploadId: 1 }`, and `{ photoId: 1, reservationFingerprint: 1 }`.
- States: `allocated`, `uploaded`, `committed`, `uncertain`, `orphan_candidate`.
- Produces: `allocateMemoryPhotoObject({ ownerId, photoId, reservationToken, reservationExpiresAt, image }) -> Promise<{ storageKey, uploadId }>`.

- [ ] **Step 1: Write failing registry/allocation tests**

Assert opaque key grammar `memory-photos/v1/<uuid>.webp`; absence of IDs/tokens/filenames from key and serialized public result; raw token absence from MongoDB; valid state schemas; indexes; concurrent same-attempt allocation returns one row/key; and different attempts receive distinct keys.

- [ ] **Step 2: Run registry tests against disposable standalone MongoDB and verify failure**

Run with current-process `MONGOD_BINARY`: `node --test --test-name-pattern="Memory Photo storage registry" test/memoryPhotoStorage.test.js`

- [ ] **Step 3: Implement registry validation and keyed fingerprints**

Use HMAC-SHA-256 with `MEMORY_PHOTO_UPLOAD_FINGERPRINT_SECRET`; never log or persist the raw token. Allocate once using an atomic upsert plus unique indexes and handle duplicate-key races by rereading the same attempt.

- [ ] **Step 4: Validate returned state and retry semantics**

Reject reuse with different normalized checksum/media attributes. Do not call fresh random allocation idempotent; idempotency applies only after the attempt row/key exists.

- [ ] **Step 5: Run focused tests and syntax checks**

Run the Task 3 test pattern and `node --check` for both new files. Expected: all matching tests pass.

### Task 4: Implement the private local provider

**Files:**
- Create: `utils/memoryPhotoLocalStorage.js`
- Extend: `utils/memoryPhotoStorage.js`
- Modify/Test: `test/memoryPhotoStorage.test.js`

**Interfaces:**
- Produces provider methods: `put({ storageKey, buffer, contentType, sha256 })`, `head({ storageKey })`, `delete({ storageKey })`, `list({ olderThan, cursor })`, `createReadGrant({ storageKey, expiresInSeconds })`, and `readGrant({ token })`.
- Local grants are opaque HMAC tokens bound to key and expiry; no HTTP route is created.

- [ ] **Step 1: Write failing private-local tests**

Use a disposable OS temp root. Assert atomic exclusive writes, same-key/same-checksum retry success, same-key/different-checksum rejection, private opaque returned keys, exact reads, expired/tampered grant rejection, traversal/absolute key rejection, paginated listing, no files beneath public `uploads/`, and complete teardown.

- [ ] **Step 2: Run local-provider tests and verify failure**

Run: `node --test --test-name-pattern="Memory Photo local storage" test/memoryPhotoStorage.test.js`

- [ ] **Step 3: Implement filesystem containment and grants**

Resolve every path under the configured private root, verify containment before I/O, write temporary file then atomically publish, and constant-time verify signed tokens. Never export an Express static directory.

- [ ] **Step 4: Run focused tests and syntax checks**

Run the Task 4 pattern and `node --check` for modified files. Expected: all matching tests pass and the temp root is removed.

### Task 5: Implement private S3 and the provider-neutral façade

**Files:**
- Create: `utils/memoryPhotoS3.js`
- Complete: `utils/memoryPhotoStorage.js`
- Modify/Test: `test/memoryPhotoStorage.test.js`

**Interfaces:**
- Façade produces: `putMemoryPhoto`, `createMemoryPhotoReadGrant`, `readLocalMemoryPhoto`, `headMemoryPhoto`, `deleteMemoryPhoto`, and `listMemoryPhotoObjects` with the spec signatures.
- `deleteMemoryPhoto` additionally requires injected/required authoritative-reference verification before provider deletion.

- [ ] **Step 1: Write failing mocked-S3 tests**

Assert `PutObjectCommand` uses only the private bucket and fixed opaque prefix, `IfNoneMatch: "*"`, `ContentType: image/webp`, SHA-256 checksum, `CacheControl: private, no-store`, `ServerSideEncryption: AES256`, and no ACL or identity metadata/tags. Test concurrent same-key writes, same-allocation matching retries verified by `HeadObject`, mismatched/unverifiable existing content rejection, successful PutObject followed by a lost response, 300-second presigning, 60/900 boundaries, missing config, provider error redaction, prefix-constrained listing, and no real network calls.

- [ ] **Step 2: Run S3 tests and verify failure**

Run: `node --test --test-name-pattern="Memory Photo S3" test/memoryPhotoStorage.test.js`

- [ ] **Step 3: Implement S3 provider and façade dispatch**

Use AWS SDK v3 commands and `getSignedUrl`. Initial writes are conditional. On precondition failure or ambiguous upload error, verify existence and checksum with `HeadObject`; accept only an exact verified match and otherwise fail closed or return an uncertain outcome. Instantiate only the selected provider. Return keys/grants rather than public permanent URLs; never fall back to existing public storage.

- [ ] **Step 4: Implement registry-backed compensated deletion checks**

Verify upload ID/key, owner/photo IDs, constant-time token fingerprint, absent current/history references, and no matching active unexpired reservation immediately before calling provider delete. Any read error or ambiguity fails closed. This path is internal immediate compensation only.

- [ ] **Step 5: Run provider tests and syntax checks**

Run Task 5 patterns and `node --check` for S3/façade files. Expected: all matching tests pass with zero AWS requests.

### Task 6: Coordinate submission and resolve ambiguous completion

**Files:**
- Create: `service/memoryPhotoSubmission.js`
- Modify/Test: `test/memoryPhotoStorage.test.js`

**Interfaces:**
- Consumes: Phase 1 `reservePhotoSlot`, `completePhotoReservation`, `releasePhotoReservation`; image normalizer; storage façade; registry.
- Produces: `submitReservedMemoryPhoto({ ownerId, file, now, reservationTtlMs })` and `reconcileMemoryPhotoSubmission({ uploadId, now })`.
- Result outcomes: `{ outcome: "completed", photo }`, `{ outcome: "uncertain", uploadId }`; confirmed domain failures throw stable existing quota/reservation errors after safe compensation attempts.

- [ ] **Step 1: Write failing workflow tests**

Cover validation-before-reservation; reserve/upload/complete success; confirmed upload failure release behavior; ambiguous upload failure with matching HEAD recovery; successful S3 write followed by injected lost response; unresolved storage outcome preserving the reservation and marking registry uncertain; explicit stale/expired completion with authoritative non-reference; successful database update followed by injected lost response; arbitrary completion timeout while authoritative read fails; current-key/history-key protection; newer reservation token protection; and compensation deletion failure.

- [ ] **Step 2: Run workflow tests and verify failure**

Run with disposable MongoDB: `node --test --test-name-pattern="Memory Photo submission" test/memoryPhotoStorage.test.js`

- [ ] **Step 3: Implement the coordinator state machine**

Normalize, reserve with a maximum 30-minute TTL, allocate, upload, mark uploaded, and complete. On every thrown completion, classify explicit domain rejection versus potentially committed failure, then reread `MemoryPhoto` before any destructive action. If the new key is current pending state, mark committed and return success. If any outcome is ambiguous, mark uncertain and preserve the object.

- [ ] **Step 4: Implement reconciliation**

For an uncertain record, mark committed only when authoritative current state references its key and stored integrity verifies. Keep uncertain while the reservation is active, storage is unverified, or reads fail. After grace and authoritative proof of no current/history reference, no active reservation, and verified registry/storage state, atomically transition it to `orphan_candidate` without deleting it.

- [ ] **Step 5: Run workflow, Phase 1, and syntax tests**

Run: `node --test --test-name-pattern="Memory Photo submission" test/memoryPhotoStorage.test.js`

Run: `node --test test/memoryPhoto.test.js`

Run: `node --check service/memoryPhotoSubmission.js`

Expected: workflow tests pass and all 28 Phase 1 tests remain passing.

### Task 7: Add manual dry-run orphan inspection

**Files:**
- Create: `service/memoryPhotoStorageCleanup.js`
- Modify/Test: `test/memoryPhotoStorage.test.js`

**Interfaces:**
- Produces: `inspectMemoryPhotoOrphans({ now, gracePeriodMs, cursor? }) -> Promise<{ dryRun: true, candidates, protected, cursor? }>`.
- Does not export a delete/sweep/schedule function.

- [ ] **Step 1: Write failing inspection tests**

Assert protection for current pending/approved/rejected keys, every moderation-history key, active unexpired reservation allocations, unresolved uncertain records, objects younger than 48 hours, malformed/foreign-prefix keys, and records encountered during pagination. Assert only sufficiently verified old records transition atomically from `uncertain` to `orphan_candidate`, reports include reason codes, and provider `delete` is never called.

- [ ] **Step 2: Add race tests around the final authoritative read**

Simulate an object becoming committed or associated with an active reservation between initial classification and final reread; assert it moves to `protected`. Simulate read failure and assert fail-closed protection.

- [ ] **Step 3: Run inspection tests and verify failure**

Run: `node --test --test-name-pattern="Memory Photo orphan inspection" test/memoryPhotoStorage.test.js`

- [ ] **Step 4: Implement paginated mark-and-report inspection**

Use the fixed prefix and validated grace, query both current and embedded history references, join registry state, perform final authoritative checks, and return bounded non-secret records. Never instantiate or invoke `DeleteObjectCommand` here.

- [ ] **Step 5: Run focused tests and syntax check**

Run the Task 7 pattern and `node --check service/memoryPhotoStorageCleanup.js`. Expected: all matching tests pass with zero deletions.

### Task 8: Document configuration and run complete verification

**Files:**
- Modify: `config.example.env`
- Modify: `README.md`
- Verify: every Phase 2 file and existing test suite

**Interfaces:**
- Documents environment names from the spec, private-bucket requirements, private local root, dry-run-only orphan inspection, and unresolved retention policy.

- [ ] **Step 1: Add documentation without values or infrastructure mutations**

Keep existing candidate/gallery documentation intact. Clearly separate existing `AWS_S3_BUCKET`/`AWS_S3_PUBLIC_URL` from Memory Photo's private variables and state that Phase 2 creates no routes or AWS resources.

- [ ] **Step 2: Scan for disclosure and public-path regressions**

Search new source/tests/docs for raw reservation tokens in persistence/logs, identity-bearing key templates, `/uploads` use, public ACLs, permanent URLs, automatic cleanup scheduling, and accidental existing-storage imports. Allow test fixtures/assertions only where necessary and non-secret.

- [ ] **Step 3: Run focused Phase 2 and Phase 1 tests**

Set `MONGOD_BINARY` only for the current process to the verified portable executable, then run:

`node --test test/memoryPhotoStorage.test.js`

`node --test test/memoryPhoto.test.js`

Expected: zero failures and zero skips.

- [ ] **Step 4: Run full backend regression suite**

Run: `npm test`

Expected: authentication, voting, candidate, gallery, existing storage, Phase 1, and Phase 2 tests all pass with disposable local MongoDB and no AWS calls.

- [ ] **Step 5: Run static and repository checks**

Run `node --check` on every created/modified JavaScript file, `git diff --check`, `git status --short`, and checks confirming no test `mongod` process or temporary test directory remains.

- [ ] **Step 6: Report without committing**

Report dependency changes, exact interfaces/indexes, focused/full test totals, any skipped tests, cleanup confirmation, unresolved retention policy, no AWS/production access, and final `git status --short`. Stop before routes, AWS provisioning, commits, or Phase 3.
