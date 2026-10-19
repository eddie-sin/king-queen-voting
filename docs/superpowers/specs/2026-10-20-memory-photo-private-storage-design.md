# Memory Photo Phase 2 Private Storage Design

## Status and scope

This specification defines Phase 2 storage architecture for Memory Photo. Phase 2 will add private image validation, persistence, read-grant generation, deletion primitives, and storage/quota coordination at the service layer. It will not add HTTP upload endpoints, moderation routes, gallery routes, likes, frontend behavior, production infrastructure, migrations, or deployment changes.

The design preserves the existing candidate and gallery storage path without modification. It also preserves Phase 1's three-slot quota, reservation-token fencing, state validation, rejected-photo history, and event settings. The Memory Photo event remains disabled by default; this phase does not configure an opening time.

Success means that a later route layer can accept an authenticated user's image, reserve one of exactly three slots, persist the image privately, atomically complete the matching unexpired reservation, and issue time-limited viewing access according to authorization decided by that route layer. Pending and rejected bytes must never become publicly addressable merely because they were uploaded.

## Current architecture findings

### Existing shared image storage

- `utils/imageStorage.js:10-23` exposes one `uploadImage(file, folder)` function. It accepts only MIME labels for JPEG, PNG, and WebP and requires an in-memory buffer (`utils/imageStorage.js:14-16`). It does not inspect file signatures or decode images.
- The shared folder allowlist is limited to candidates and four gallery sections (`utils/imageStorage.js:11-13`). Memory Photo is not an accepted folder.
- In production, the helper delegates to S3 (`utils/imageStorage.js:17`). In non-production, it writes beneath `LOCAL_UPLOAD_DIR`, defaulting to the repository's `uploads` directory, and returns a `/uploads/...` URL (`utils/imageStorage.js:8,19-23`).
- `app.js:24-29` publicly serves that entire local upload directory without authentication outside production. This is incompatible with private pending and rejected Memory Photos.
- `utils/s3.js:2,19-29` uses AWS SDK v3 `S3Client` and `PutObjectCommand`, relying on the SDK credential provider chain. It uploads the original buffer with its client-supplied MIME type and does not set an ACL, encryption option, checksum, cache policy, object metadata, or tags.
- S3 keys are `<folder>/<random UUID>.<extension>` (`utils/s3.js:5-9,20`). The helper returns a permanent public bucket URL or configured CDN base URL (`utils/s3.js:31-35`); it does not return an object key independently and cannot generate signed URLs.
- `README.md:23-25` explicitly documents public local uploads and a bucket/CDN that permits public viewing. Therefore existing-bucket privacy is not verified and must not be assumed.
- The installed AWS package is `@aws-sdk/client-s3` (`package.json:15`). No S3 presigner, image decoder, signature-detection, or metadata-stripping package is currently declared (`package.json:14-26`).

### Upload middleware and consumers

- Multer uses memory storage and globally caps each file at 5 MiB, with up to 10 files per request (`middleware/upload.js:4-6`). Its filter trusts the multipart MIME label (`middleware/upload.js:7-12`).
- Candidate uploads use field `images`, at most three files; gallery uploads use the same field, at most ten (`middleware/upload.js:15-19`). A Phase 2 storage service can consume the same Multer file shape (`buffer`, `mimetype`, and original-name metadata), but Memory Photo needs its own single-file middleware export in a later HTTP phase so existing limits and fields are not changed.
- Gallery creation is admin-only (`route/imagesRoutes.js:8-13`), but gallery reads are public. Its controller stores returned public URLs in the existing `Image` model (`controller/imagesController.js:6-14,17-37`; `model/imagesModel.js:3-12`). Deleting a gallery database record does not delete its object (`controller/imagesController.js:40-47`).
- Existing storage tests assert public S3 URLs and publicly served local files (`test/storage.test.js:15-65`; `test/api.test.js:565-600`). These are compatibility tests for candidate/gallery behavior, not a suitable contract for Memory Photo.

### Phase 1 integration points

- `MemoryPhoto.storageKey` is the persistent storage identifier; status validation requires it for pending, approved, and rejected states (`model/memoryPhotosModel.js:24-51,69-81`). It should remain an opaque object key, never a display URL.
- Historical rejected submissions retain their storage keys and timestamps in `moderationHistory` (`model/memoryPhotosModel.js:58-67`). Storage cleanup must regard both current and historical keys as referenced.
- Reservation completion already atomically requires photo ID, owner ID, `reserved` status, matching token, and `reservationExpiresAt > now` (`service/memoryPhotoQuota.js:129-175`). Phase 2 must call this operation only after a successful private write.
- Releasing or recovering a replacement reservation restores the prior rejected state; no Phase 1 operation deletes image objects (`service/memoryPhotoQuota.js:177-264`).
- Settings use one fixed document ID, default disabled, and require an opening time before enablement (`model/memoryPhotoSettingsModel.js:3-30`). Phase 2 storage primitives must not silently enforce or modify event timing; later route/application policy will check it before reserving.
- Existing user/admin middleware verifies HS256 bearer tokens, active accounts, and role identity (`middleware/authMiddleware.js:8-34`). Later HTTP phases—not the storage service—will use those identities to decide owner/admin access.

## Architecture decision

### Recommended: separate private bucket

Use a dedicated private S3 bucket for Memory Photo. This is the preferred architecture because the existing bucket is explicitly designed for public candidate/gallery delivery. A separate bucket creates a policy boundary that cannot be weakened accidentally by the existing public bucket policy, CDN origin, or future candidate/gallery changes.

Required bucket posture:

- Enable all four S3 Block Public Access settings at bucket level and account level where operationally possible.
- Disable ACL-based access by using Object Ownership `BucketOwnerEnforced`.
- Deny non-TLS requests with a bucket policy.
- Use S3-managed server-side encryption (SSE-S3). Phase 2 does not require a customer-managed KMS key.
- Do not attach this bucket to the existing public CDN. If a CDN is added later, use a private origin with signed application-controlled access; it is not required for Phase 2.
- Enable versioning only if recovery from operator overwrite/delete is worth its extra storage and lifecycle complexity. Keys are immutable and random, so versioning is not required for application correctness.

### Conditional alternative: protected prefix in the existing bucket

A prefix such as `memory-photo-private/` is acceptable only after infrastructure review proves all of the following:

- Bucket policy and every access point deny anonymous reads for the prefix.
- Existing public bucket statements are scoped narrowly and cannot match that prefix.
- Any CDN distribution excludes the prefix or uses a private origin and signed access.
- S3 Block Public Access remains enabled; public candidate/gallery delivery has been moved behind a controlled CDN or otherwise remains functional without public bucket policy.
- Automated policy tests verify unauthenticated GET denial.

Because current documentation requires a publicly viewable bucket/CDN, this alternative has a high configuration-regression risk and is not recommended.

## Component design and file scope

The later Phase 2 implementation should be additive and narrowly scoped.

### New `utils/memoryPhotoStorage.js`

This is the environment-neutral façade. It validates configuration and delegates to either private S3 or private local storage. It owns key construction and exposes the interface defined below. It must never call or modify `utils/imageStorage.js`.

### New `utils/memoryPhotoS3.js`

This module owns the private S3 client, `PutObject`, `GetObject` signing, `HeadObject`, `DeleteObject`, and prefix-listing primitives. It always uses the dedicated Memory Photo bucket configuration and returns keys/read grants, never public URLs. It must reject missing production configuration rather than falling back to local disk.

### New `utils/memoryPhotoLocalStorage.js`

This module writes under a dedicated private directory outside `imageStorage.localUploadDirectory` and returns opaque storage keys. It offers controlled reads to the service layer but is never mounted with `express.static`. Path resolution must prove the final target remains within the configured private root.

### New `utils/memoryPhotoImage.js`

This module decodes and normalizes supported input. It verifies actual image content, rejects malformed/polyglot input, constrains decoded dimensions/pixels, normalizes orientation, and re-encodes to an approved output while stripping EXIF/XMP/IPTC metadata and embedded thumbnails. The recommended implementation dependency is `sharp`; it provides real decoding and metadata removal rather than a hand-written magic-byte check. Exact dependency/version selection belongs in the implementation plan and requires approval before installation.

### New `service/memoryPhotoSubmission.js`

This coordinator composes image normalization, private storage, and the existing quota service. It owns the reserve → store → complete sequence and best-effort compensation. It does not perform authentication, event-window authorization, moderation, or HTTP response mapping.

### New `service/memoryPhotoStorageCleanup.js`

This module performs an explicit, manual, dry-run orphan inspection. It reports old objects that appear unreferenced after all protection checks, but Phase 2 neither schedules cleanup nor authorizes deletion through this module. No inspection function accepts a user-supplied prefix. A later separately approved phase may add destructive cleanup only after operational validation of the report.

### New `model/memoryPhotoStorageObjectsModel.js`

This internal registry binds each opaque object key to trusted server-side upload state without exposing owner IDs, photo IDs, or reservation tokens through S3. It contains a unique `storageKey`, `photoId`, `ownerId`, a keyed reservation-token fingerprint rather than the raw token, `reservationExpiresAt`, normalized checksum and media metadata, `state` (`allocated`, `uploaded`, `committed`, `uncertain`, or `orphan_candidate`), optional `uncertainSince`, optional `orphanCandidateAt`, and timestamps. The registry is operational metadata, not a public model. It does not replace `MemoryPhoto.storageKey` as the authoritative committed reference.

The keyed token fingerprint is computed with a server secret and constant-time compared when practical. It permits compensation to prove that trusted photo/owner/token inputs match the object allocation without placing the raw token in the registry, object key, S3 metadata, logs, or URLs. Unique indexes on `storageKey` and on the upload-attempt identity prevent duplicate registry entries.

### New `test/memoryPhotoStorage.test.js`

Focused unit and filesystem integration tests cover validation, key generation, private local behavior, mocked S3 commands/signing, coordination compensation, and cleanup safeguards. Existing `test/storage.test.js`, `test/memoryPhoto.test.js`, and the full `npm test` suite remain regression gates.

### Expected dependency/documentation files

- `package.json` and `package-lock.json`: add `sharp` and the AWS S3 presigner package after version and deployment compatibility review.
- `config.example.env`: document names and safe descriptions only. No values or credentials belong in source control.
- `README.md`: document the separate private-storage contract without changing existing public candidate/gallery instructions.

Phase 2 must not modify `utils/s3.js`, `utils/imageStorage.js`, existing controllers/routes/models, `app.js`, `middleware/upload.js`, or frontend files. A later upload-endpoint phase may add a separate Memory Photo Multer export and routes.

## Storage service interface

The façade should expose these CommonJS functions:

```js
normalizeMemoryPhoto(file, options?)
// -> Promise<{ buffer, contentType, extension, byteLength, width, height, sha256 }>

allocateMemoryPhotoObject({ ownerId, photoId, reservationToken, reservationExpiresAt, image })
// -> Promise<{ storageKey, uploadId }>

putMemoryPhoto({ storageKey, uploadId, image })
// -> Promise<{ storageKey, etag?, checksumSha256? }>

createMemoryPhotoReadGrant({ storageKey, expiresInSeconds })
// -> Promise<{ kind: "url", url, expiresAt } | { kind: "local", token, expiresAt }>

readLocalMemoryPhoto({ token })
// -> Promise<{ stream, contentType, contentLength }>; local provider only

headMemoryPhoto({ storageKey })
// -> Promise<{ exists, contentType?, contentLength?, checksumSha256? }>

deleteMemoryPhoto({ storageKey, uploadId, expected })
// -> Promise<{ deleted: boolean }>

// -> Promise<{ objects, cursor? }>; internal inspection use only
```

`expected` contains the owner/photo/reservation identity derived from trusted server state. Implementations must parse the key and refuse deletion when it does not match. This reduces damage from programming errors and prevents arbitrary-key deletion.

The submission coordinator should expose:

```js
submitReservedMemoryPhoto({ ownerId, file, now, reservationTtlMs })
// -> Promise<{ photo, reservation }>

inspectMemoryPhotoOrphans({ now, gracePeriodMs, cursor? })
// -> Promise<{ dryRun: true, candidates, protected, cursor? }>
```

It returns the completed pending `MemoryPhoto`; it never returns a bucket URL. The later route layer maps quota/storage errors to HTTP responses.

Read authorization is intentionally outside `createMemoryPhotoReadGrant`: callers must first prove one of these policies:

- owner access: authenticated `userId` equals `photo.ownerId`, for the current photo only;
- admin access: authenticated active administrator, for current submissions and explicitly selected historical entries;
- public gallery access: current status is `approved` and the gallery window is open.

Keeping policy outside the storage driver makes the driver testable and prevents it from importing authentication or settings models. Storage keys and raw local read tokens must not appear in ordinary public API payloads.

## Key strategy and object metadata

Use immutable, opaque server-generated keys:

```text
memory-photos/v1/<randomUUID>.webp
```

The random UUID is allocated once in the internal storage-object registry before the S3 write. Raw owner IDs, photo IDs, reservation tokens, token hashes, and original filenames never appear in the key. This matters because a presigned GET URL reveals the underlying S3 key. A new replacement receives a new key; historical keys remain immutable.

Do not put identity or moderation data in user-visible S3 metadata or tags. S3 receives only non-sensitive delivery/integrity attributes: static WebP `Content-Type`, `Content-Length`, checksum where supported, `Cache-Control: private, no-store`, and SSE-S3. Do not set a public ACL. Owner/photo/reservation associations exist only in MongoDB's internal registry.

Deletion is allowed only for immediate upload compensation, not orphan cleanup, in Phase 2. The caller supplies the opaque key and registry upload ID plus trusted owner/photo/raw-token inputs held by the coordinator. The storage service loads the registry row, verifies key and upload ID, recomputes and compares the token fingerprint, checks the expected owner/photo IDs, and then rereads authoritative `MemoryPhoto` state to prove the key is absent from both current and historical references. A mismatch or unavailable/ambiguous database result fails closed without calling S3 deletion.

The database stores only `storageKey`. Display access is generated on demand and never persisted because signed URLs expire and may reveal deployment details.

## Upload and failure-recovery workflow

1. A future authenticated route checks Memory Photo settings and upload window, then passes the authenticated owner and one Multer in-memory file to the coordinator. Phase 2 itself has no route.
2. The coordinator validates and normalizes the image before consuming a slot. Invalid images therefore create neither reservations nor objects.
3. It calls `reservePhotoSlot`. The returned `photo._id`, owner, token, and expiry become the trusted upload identity.
4. It rechecks sufficient remaining time locally, allocates one opaque key and registry record for that exact reservation, and uploads the normalized static WebP to that key. S3/local storage is private from creation.
5. It calls `completePhotoReservation` with the exact photo ID, owner ID, reservation token, returned storage key, and current time. The Phase 1 atomic predicate rejects expired or stale reservations.
6. On success, the current database record is the durable reference. A replaced rejected photo remains referenced in `moderationHistory`; it is not deleted.

Failure handling:

- Normalization fails: return a validation error; no reservation or object exists.
- Reservation fails: return quota/domain error; no object exists.
- Storage write fails: token-fenced release restores a prior rejected state or removes a new reservation. A release failure is reported/logged without weakening token predicates; later expiry recovery can reclaim it.
- Confirmed storage failure means S3 explicitly rejected the conditional write and a subsequent authoritative `HeadObject` confirms that no matching object exists. Only that confirmed outcome may proceed to token-fenced reservation release.
- Ambiguous storage outcome includes timeout, connection loss, or a response lost after S3 may have accepted the write. Preserve the registry allocation and perform `HeadObject` with checksum/integrity verification. Matching stored content is a successful retry; mismatched or unverifiable content fails closed. If no authoritative result is available, mark the registry `uncertain`, preserve the object/reservation, and do not release or delete based solely on the thrown upload error.
- Confirmed completion rejection: an explicit Phase 1 `MEMORY_PHOTO_RESERVATION_EXPIRED` or `MEMORY_PHOTO_RESERVATION_STALE` result is not by itself sufficient to delete. Reread authoritative `MemoryPhoto` state. Delete the just-created object only when that read succeeds, the key is absent from current and historical references, no matching active unexpired reservation remains, and the registry identity checks pass. Then attempt token-fenced release. Never delete the previous rejected key.
- Uncertain completion outcome: timeouts, connection loss, process interruption, or an error that could occur after MongoDB accepted the update must never trigger immediate deletion. Reread authoritative state. If the current `MemoryPhoto.storageKey` equals the new key and status is `pending`, completion is confirmed and the registry becomes `committed`. If the authoritative read proves the object was not committed and no matching active reservation remains, compensation may proceed. If the read fails, conflicts, or cannot prove either result, mark the registry `uncertain`, preserve the object, and return an outcome requiring later reconciliation.
- Successful update followed by lost response: the reread observes the new pending key, treats submission as successful, and never releases the reservation or deletes the object.
- Delete compensation fails: record an operational error and leave the object for orphan reconciliation; do not alter a newer reservation.
- Process crash between object write and completion/compensation: the immutable object is initially orphaned. Cleanup may remove it only after the grace period and only when no current or historical database reference exists.

Phase 2.1 remediation requires a fresh trusted-clock reading before upload and completion; request-start time is not a valid completion time. Immediate compensation first atomically releases/restores the exact reservation token, which fences later completion. Only after that fence succeeds may registry identity and current/history references be rechecked and the new object deleted. If completion wins, the release is stale and the object remains committed. Provider-write success and registry-persistence success are tracked as distinct outcomes; any failure after storage may have accepted bytes remains uncertain.
- Process crash after completion: the database reference protects the object from cleanup.
- Concurrent expiration recovery versus completion: Phase 1 token/status/expiry predicates determine one winner. Cleanup of the newly written key occurs only when completion did not succeed; it cannot restore or delete a pending database record.

S3 and standalone MongoDB cannot provide one cross-system transaction. The design therefore provides a once-allocated opaque key, fenced database transitions, authoritative rereads, targeted compensation, and conservative reconciliation rather than claiming impossible atomicity.

Retries use an explicit upload-attempt identity. Repeating `allocateMemoryPhotoObject` for the same photo and reservation fingerprint returns the existing registry allocation; it does not generate another key. The initial S3 `PutObject` uses `IfNoneMatch: "*"` so an immutable key cannot be overwritten. If a concurrent or retried conditional write reports that the key exists, `HeadObject` must verify the stored checksum and expected static-WebP attributes. Matching content is treated as a successful retry; mismatched or unavailable integrity evidence is rejected without overwrite or deletion. Completion retries use the same Phase 1 identifiers and resolve thrown/ambiguous results by rereading state. No operation that creates a fresh random allocation is described as idempotent.

## Orphan prevention and retention

Phase 2 orphan inspection follows a non-destructive mark-and-report rule:

1. List only the fixed `memory-photos/v1/` prefix, in bounded pages.
2. Use an initial 48-hour grace period. Before implementation, verify that 48 hours exceeds the maximum reservation/upload duration plus documented clock-skew allowance; fail configuration validation if it does not.
3. Protect every current `MemoryPhoto.storageKey` and every embedded `moderationHistory.storageKey`.
4. Protect registry objects tied to a current active, unexpired reservation, even though the reserved photo has no `storageKey` yet.
5. Protect every registry object in `uncertain` state until reconciliation verifies storage state and authoritative MongoDB state.
6. Transition `uncertain` to `orphan_candidate` atomically only after the grace period and after checks prove: no current reference, no historical reference, no active reservation able to commit the key, and sufficiently verified storage/registry identity. Any unavailable, conflicting, or changing evidence leaves the record `uncertain`.
7. Report only `orphan_candidate` records and independently old unregistered objects that meet the same proof standard. Recheck all conditions immediately before reporting.
8. Return `dryRun: true` with reasons for candidate/protected classification. Do not issue `DeleteObject` from orphan inspection in Phase 2.

Crash reconciliation also examines aged `allocated` and `uploaded` registry rows, because process termination can occur before either transition to `uncertain`. `reconcileMemoryPhotoSubmission({ uploadId, now })` verifies stored integrity and authoritative current/history/reservation state before marking a referenced upload committed or leaving it uncertain.

Phase 2.3 completes the registry state machine. `compensating` records carry `compensatingAt`; `deleted` records carry `deletedAt` and are durable terminal evidence that provider deletion was confirmed. The allowed recovery transitions are:

| From | To | Required evidence |
| --- | --- | --- |
| `allocated` | `uploaded` | Provider write succeeded and registry update matched. |
| `allocated` / `uploaded` | `uncertain` | Storage or registry outcome cannot be proved. |
| `uploaded` / `uncertain` / `compensating` | `committed` | Current or historical authoritative reference plus matching stored integrity; transition success is verified. |
| `allocated` / `uploaded` / `uncertain` / `orphan_candidate` | `compensating` | Exact registry identity and a successfully released token-fenced reservation precede compensation. |
| `compensating` | `uncertain` | Deletion failed, a reference appeared, or the outcome remains ambiguous. |
| aged `compensating` | `orphan_candidate` | Object exists, is unreferenced, reservation is inactive, integrity matches, and the grace period passed. |
| `compensating` | `deleted` | Object deletion succeeded, or reconciliation authoritatively confirms the object is absent and unreferenced. |

Dry-run inspection includes aged `compensating` rows and performs no provider deletion. Failed or unmatched registry transitions never produce a successful completion result. Ordinary submission input contains no timestamp override; reservation start, pre-upload checks, and completion time come only from the internally injected trusted clock.

Inspection must never classify rejected history merely because it is not the current image. Phase 2 defines no automatic retention period for referenced historical objects. The future team decision on post-event photo and account retention remains unresolved; until a policy is approved, referenced current and historical objects are never automatically deleted.

Bucket lifecycle rules may abort incomplete multipart uploads. They must not expire normal objects under the main prefix based solely on age, because approved, rejected, and historical photos can remain valid indefinitely. If a later design introduces a distinct staging prefix, it may have a lifecycle rule only after its commit/reconciliation semantics are specified and tested.

## Private read delivery

Production uses presigned S3 GET URLs generated only after the application authorizes the requester. Recommended default expiry is 300 seconds, configurable within a hard server-side range of 60–900 seconds. The response should use an inline content disposition with a server-generated filename and the normalized content type. Approval makes an object eligible for public-gallery authorization; it does not make the bucket or object public.

Owners and admins receive the same short-lived mechanism after their respective authorization checks. A URL is bearer access until it expires, so responses containing it must use `Cache-Control: private, no-store`, and URLs must not be logged or stored in MongoDB.

Local development uses an opaque, HMAC-authenticated, short-lived read token bound to one storage key and expiry. The later asset route validates that token and streams from the private local provider with `nosniff`, explicit content type/length, and no-store caching. The private root is not mounted with `express.static` and must not sit beneath `uploads/` or any frontend public directory.

## Image security and privacy

- Accept decoded JPEG, PNG, and WebP only. HEIC/HEIF receives an explicit user-friendly unsupported-format error in version 1. Do not trust extension, original filename, or multipart MIME type.
- Keep Multer's transport limit at 5 MiB for the future single-file middleware. Independently enforce a 5 MiB normalized-output limit, 16-megapixel limit, and maximum width and height of 8192 pixels to prevent decompression bombs. Both per-axis and total-pixel limits apply.
- Fully decode and re-encode. Reject corrupt, truncated, animated/multipage, oversized, and unsupported images. Normalize orientation and strip all metadata by default, including GPS/location, device, timestamp, embedded thumbnails, ICC comments where not required, XMP, IPTC, and EXIF.
- Use Sharp to produce a single-frame static WebP with deterministic encoding settings. Preserve decoded transparency. Sharp's exact version and native deployment compatibility must be reviewed before installation.
- Compute a SHA-256 content digest after normalization for integrity/diagnostics. Do not use it as the only object-key component or as proof of authorization.
- Never return raw AWS errors, bucket names, local absolute paths, keys, tokens, or signed query strings in public error bodies or logs.
- Presigned URL generation does not replace authorization. The application must load the `MemoryPhoto` record and apply owner/admin/approved-gallery policy before asking storage for a grant.

## IAM least privilege

The application role should be restricted to the dedicated bucket and fixed prefix:

- `s3:PutObject`, `s3:GetObject`, `s3:HeadObject` (covered by `GetObject` authorization in IAM evaluation), and `s3:DeleteObject` on `arn:aws:s3:::<private-bucket>/memory-photos/v1/*`.
- `s3:ListBucket` on the bucket only for explicit dry-run orphan inspection, conditioned to the fixed prefix.
Do not grant ACL-management, bucket-policy, bucket deletion, unrestricted `s3:*`, access to the existing public bucket, or cross-account access unless separately reviewed. Prefer workload/instance roles over long-lived access keys in production. Local credentials, if needed, use the normal AWS SDK provider chain and remain outside Git.

## Automated testing strategy

### Image normalization tests

- Valid JPEG, PNG, and WebP fixtures are decoded, bounded, re-encoded, and return verified metadata.
- A file whose MIME label disagrees with its bytes is rejected or classified by decoded content according to the final API contract.
- HTML/script payloads, truncated images, polyglot-style fixtures, animated/multipage files, excessive dimensions/pixels, and oversized normalized output are rejected.
- GPS/EXIF/XMP and original filename metadata are absent after normalization.
- HEIC/HEIF input receives the version-1 unsupported-format error, not a generic server failure.
- Every accepted input produces one static WebP no larger than 5 MiB and 16 megapixels and within the configured width/height bounds.

### Private local-provider tests

- Files are written under a fresh OS temporary directory outside the public upload root.
- Returned values are keys, not `/uploads` URLs or absolute paths.
- Traversal, absolute paths, malformed keys, expired/tampered read tokens, and provider mismatch are rejected.
- Reads return only the exact key; test teardown removes the disposable directory.

### Mocked S3 contract tests

- `PutObjectCommand` targets only the private bucket/prefix, sets normalized headers/checksum/encryption, and has no public ACL.
- Presigned GET grants have bounded expiry and target the exact key.
- Delete/list commands enforce key/prefix restrictions and expected identity.
- Missing production bucket/region configuration fails closed without local fallback.
- AWS timeout, throttling, access-denied, and partial-response errors map to stable storage errors without leaking details.

No test may call a real AWS account. Mock at the AWS SDK client/signer boundary. An optional LocalStack/MinIO suite may be documented separately but is not required and must remain disposable.

### Coordinator and recovery tests

- Validation occurs before reservation.
- Upload failure releases a new reservation and restores a rejected replacement exactly.
- A confirmed non-commit deletes only the new registry-bound object after authoritative current/history/reference checks; token-fenced release cannot affect a newer reservation.
- A successful MongoDB completion followed by a simulated lost response is recovered by authoritative reread and neither object deletion nor reservation release occurs.
- A failed or inconclusive authoritative reread marks the upload uncertain and preserves its object.
- Simulated delete failure leaves an orphan detectable by reconciliation.
- Dry-run orphan inspection protects current pending/approved/rejected keys, every moderation-history key, active unexpired reservations, and uncertain uploads; it reports but does not delete old unreferenced keys.
- Completion-versus-recovery and stale-token races retain Phase 1 behavior.
- Existing 28 Memory Photo tests and the complete backend suite remain passing.

## AWS and environment configuration

Environment variable names proposed for Memory Photo are:

- `MEMORY_PHOTO_STORAGE_DRIVER`
- `MEMORY_PHOTO_S3_BUCKET`
- `MEMORY_PHOTO_S3_REGION`
- `MEMORY_PHOTO_SIGNED_URL_TTL_SECONDS`
- `MEMORY_PHOTO_LOCAL_STORAGE_DIR`
- `MEMORY_PHOTO_LOCAL_SIGNING_SECRET`
- `MEMORY_PHOTO_ORPHAN_GRACE_SECONDS`
- `MEMORY_PHOTO_MAX_INPUT_BYTES`
- `MEMORY_PHOTO_MAX_OUTPUT_BYTES`
- `MEMORY_PHOTO_MAX_PIXELS`
- `MEMORY_PHOTO_MAX_WIDTH`
- `MEMORY_PHOTO_MAX_HEIGHT`
- `MEMORY_PHOTO_UPLOAD_FINGERPRINT_SECRET`
- `MEMORY_PHOTO_MAX_RESERVATION_SECONDS`
- `MEMORY_PHOTO_CLOCK_SKEW_SECONDS`

The AWS SDK credential provider chain may use workload credentials or the conventional credential environment names already documented by the project. Credentials must not receive Memory Photo-specific names or be copied into application responses. `AWS_S3_BUCKET` and `AWS_S3_PUBLIC_URL` remain exclusively associated with existing public candidate/gallery storage.

Required AWS resources/configuration, to be created only in a separately approved infrastructure step:

- one private S3 bucket in the selected region;
- Block Public Access and BucketOwnerEnforced ownership;
- SSE-S3 encryption configuration;
- least-privilege application IAM policy/role;
- CORS is not required for server-upload/server-download architecture; add no browser-origin CORS rule in Phase 2;
- lifecycle rule only for incomplete multipart uploads unless a later retention policy is approved; no object-expiration rule in Phase 2;
- access logging/CloudTrail data events only if their cost and sensitive-key logging implications are accepted.

## Cost and resource considerations

Primary costs are stored bytes, PUT/GET/LIST requests, outbound transfer for image viewing, and optional audit logs. Short signed URLs do not add a separate S3 fee but every view causes a GET and transfer. Re-encoding reduces transfer/storage and removes metadata at the cost of application CPU and memory. In-memory Multer plus decoding can multiply memory usage; later routes need strict single-file limits and normal process-level concurrency controls.

A separate bucket has negligible fixed cost and improves accounting, policy isolation, lifecycle safety, and incident response. Cleanup LIST operations should be paginated and scheduled conservatively. A CDN may reduce repeated S3 transfer/request costs for popular approved images, but private-origin and signed-delivery design should be a later optimization based on measured traffic.

## Risks, assumptions, and unresolved decisions

### Risks

- There is no true atomic transaction across S3 and standalone MongoDB. Compensation and conservative reconciliation reduce, but cannot eliminate, transient orphan windows.
- Signed URLs are transferable bearer URLs until expiry. Short TTL, no-store responses, TLS, and avoiding logs limit exposure but cannot revoke a URL instantly without additional proxy/CDN controls.
- Native image-processing dependencies add build/runtime compatibility requirements and must be verified on the deployment platform.
- In-memory upload and decoding create denial-of-service pressure if later routes lack request-rate and concurrency limits.
- An incorrectly scoped existing-bucket policy could expose private objects; this is why a separate bucket is recommended.
- Indefinite preservation of rejected history can create unbounded storage and privacy-retention obligations; post-event photo and account retention remains a future team decision.

### Assumptions

- The backend, not browsers, uploads bytes to S3. Direct browser presigned PUT is outside Phase 2.
- The application runs with a trustworthy server clock, required by reservation expiry and signed URL expiry.
- Later route phases will enforce authentication, settings windows, owner/admin/public-gallery authorization, and safe HTTP caching.
- Approved images remain private S3 objects; “public” means any viewer may request a short-lived URL through an application endpoint while the gallery is open.
- Object keys are not secrets and do not grant access, but are still omitted from public payloads to reduce information disclosure.

### Decisions required before the implementation plan

1. Verify `sharp@^0.35.5` native binary/build compatibility with the actual production deployment platform before installation; local npm metadata confirms Node 24 compatibility but does not identify that platform.
2. Validate the selected 30-minute maximum reservation duration and 5-minute clock-skew allowance against the future route/runtime design. The fixed 48-hour grace must remain greater than their sum.
3. Decide in a later phase whether and how dry-run orphan reports can become destructive cleanup; Phase 2 provides no such authorization or schedule.
4. Define the future post-event retention policy for photos, moderation history, user accounts, and their relationship. Until then, referenced historical objects are never automatically deleted.

## Compatibility boundary

The architecture deliberately isolates Memory Photo storage from existing public candidate/gallery storage. Phase 2 implementation must not change existing URL formats, local `/uploads` serving, S3 public URL behavior, controller/route contracts, election settings, authentication behavior, Phase 1 models, or quota predicates. It must not create AWS resources or access production data during tests.

## Authoritative AWS references

- [Amazon S3 access control and Object Ownership](https://docs.aws.amazon.com/AmazonS3/latest/user-guide/access-control-overview.html)
- [Amazon S3 presigned URL behavior and limitations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Amazon S3 `PutObject`, checksums, and encryption request behavior](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)
- [Aborting incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/abort-mpu.html)
