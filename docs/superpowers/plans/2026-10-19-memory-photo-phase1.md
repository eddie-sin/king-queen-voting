# Memory Photo Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add validated Memory Photo persistence, concurrency-safe three-slot reservation management, rejected-submission history, and focused disposable-database tests without exposing HTTP or storage integrations.

**Architecture:** A persistent `MemoryPhoto` document represents one of three indexed slots for one user. Atomic, token-fenced service transitions reserve, complete, release, and recover slots; rejected state is snapshotted in an embedded history before replacement. Separate like and fixed-ID settings models enforce their own database invariants.

**Tech Stack:** CommonJS, Node.js built-in test runner, Mongoose 9, MongoDB standalone `mongod`, Node `crypto`.

**Spec:** `docs/superpowers/specs/2026-10-19-memory-photo-phase1-design.md`

## Global Constraints

- Work only on `feat/memory-photo-phase1`.
- Do not add routes, frontend code, S3 commands, migrations, deployments, or package dependencies.
- Do not modify existing voting, authentication, candidate, gallery, election-schedule, or AWS S3 behavior.
- Tests may connect only to a disposable local standalone `mongod`; there is no remote fallback.
- Do not invent an October 25 opening time or any closing timestamp, and do not enable the feature.
- Do not delete image objects or store image binaries in MongoDB history.
- Do not commit, push, merge, deploy, or create a pull request.
- Every production behavior follows a red/green TDD cycle; run the existing complete root suite before reporting completion.

## File Map

- Create `model/memoryPhotosModel.js`: MemoryPhoto schema, moderation-history subdocument, indexes, and shared cross-field state validation.
- Create `model/memoryPhotoLikesModel.js`: unique per-user/per-photo like schema.
- Create `model/memoryPhotoSettingsModel.js`: fixed-ID singleton event settings and chronological validation.
- Create `service/memoryPhotoQuota.js`: atomic reservation, completion, release, and expiration recovery operations.
- Create `test/memoryPhoto.test.js`: disposable-standalone-Mongo integration and model tests.
- Do not modify application route registration or existing model/service files.

## Review Focus

- Boundary time: completion when `reservationExpiresAt === now` must fail and leave the reservation unchanged; covered in Task 4.
- Corrupt or incomplete state: service transitions must reject/flag an invalid returned state instead of assuming pipeline validators ran; covered in Task 4.
- Old token after slot reuse: stale completion and release must not mutate the newer reservation; covered in Tasks 4 and 5.
- Multiple prior rejections: failed replacement must pop only the current reservation snapshot and preserve all earlier history; covered in Task 5.
- Concurrent fourth claimant: four or more simultaneous requests must produce exactly three reservations and quota-domain failures, never a raw duplicate-key error; covered in Task 3.

---

### Task 1: Memory Photo schemas and database indexes

**Files:**
- Create: `test/memoryPhoto.test.js`
- Create: `model/memoryPhotosModel.js`
- Create: `model/memoryPhotoLikesModel.js`

**Interfaces:**
- Produces `MemoryPhoto`, with static `MemoryPhoto.assertState(state)` and unique index `{ ownerId: 1, slot: 1 }`.
- Produces `MemoryPhotoLike` with unique index `{ userId: 1, photoId: 1 }`.
- `moderationHistory` entries contain `storageKey`, literal status `rejected`, `submittedAt`, `reviewedBy`, `reviewedAt`, `rejectionReason`, `originalCreatedAt`, and `originalUpdatedAt`; embedded `_id` is disabled.

- [ ] **Step 1: Add the disposable Mongo test harness and failing valid-schema tests**

  Start `process.env.MONGOD_BINARY || "mongod"` on a free localhost port with a temporary dbpath, verify `hello.setName` is absent, connect Mongoose to a unique database, initialize only the new model indexes, and clean up connection/process/directory in `after`. Create disposable User/Admin records. Assert valid reserved, pending, approved, and rejected MemoryPhoto documents save with timestamps and valid references.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: FAIL because the new model modules do not exist.

- [ ] **Step 3: Implement the minimal MemoryPhoto schema and shared invariant validator**

  Define the fields from the spec, including internal `reservationToken` and `submittedAt`, timestamps, and the compound unique index. Implement `MemoryPhoto.assertState(state)` as the single cross-field rule source and invoke it from document validation. It must reject invalid slot values and every required/forbidden field combination for `reserved`, `pending`, `approved`, and `rejected`.

- [ ] **Step 4: Add failing invalid-state and slot-uniqueness tests**

  Assert rejection of slot 0/4/non-integer, missing reserved token/expiry, reserved storage/review metadata, pending without storage key/submission time, pending with reservation/review metadata, approved without reviewer/review time, approved with rejection reason, rejected without reason/reviewer/review time, and non-rejected history entries. Insert the same owner/slot twice and assert Mongo duplicate-key code `11000`.

- [ ] **Step 5: Run focused tests, implement any missing schema validation, and verify GREEN**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: all Task 1 MemoryPhoto tests pass.

- [ ] **Step 6: Add a failing duplicate-like test**

  Insert one like, then assert a second `{ userId, photoId }` insert fails with code `11000`; also assert required references and automatic `createdAt` with no `updatedAt` requirement.

- [ ] **Step 7: Implement MemoryPhotoLike and verify GREEN**

  Create the schema and unique compound index, initialize it in test setup, then run `node --test test/memoryPhoto.test.js` and expect all Task 1 tests to pass.

### Task 2: Fixed-ID Memory Photo settings

**Files:**
- Modify: `test/memoryPhoto.test.js`
- Create: `model/memoryPhotoSettingsModel.js`

**Interfaces:**
- Produces `MemoryPhotoSettings.SETTINGS_ID === "memory-photo-settings"` and a model whose `_id` is fixed to that value.
- Fields: `enabled`, `opensAt`, `uploadsCloseAt`, `likesCloseAt`, `galleryClosesAt`.

- [ ] **Step 1: Write failing settings-default and singleton tests**

  Assert a default document has fixed `_id`, `enabled === false`, and all four dates null. Assert a caller-supplied different `_id` fails validation, while repeated upsert by the fixed ID addresses the same record.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: FAIL because the settings model does not exist.

- [ ] **Step 3: Implement fixed-ID settings schema**

  Use a String `_id` with default and validator restricted to `"memory-photo-settings"`; default disabled and dates to null. Do not seed or derive any October 25 timestamp.

- [ ] **Step 4: Add failing chronological validation tests**

  Assert enabled-with-null-opens fails; disabled-with-null-dates passes; each configured closing field equal to or earlier than `opensAt` fails; each closing field later than `opensAt` passes independently; disabled documents with configured dates still enforce chronology.

- [ ] **Step 5: Implement cross-field settings validation and verify GREEN**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: all Tasks 1–2 tests pass.

### Task 3: Atomic three-slot reservation

**Files:**
- Modify: `test/memoryPhoto.test.js`
- Create: `service/memoryPhotoQuota.js`

**Interfaces:**
- Produces `reservePhotoSlot({ ownerId, now, reservationTtlMs }) -> Promise<MemoryPhoto>`.
- Produces `MemoryPhotoQuotaError` with stable `code === "MEMORY_PHOTO_QUOTA_FULL"` for exhausted quota.
- Returned reserved documents include a cryptographically random `reservationToken` and `reservationExpiresAt = now + reservationTtlMs`.

- [ ] **Step 1: Write failing sequential quota tests**

  Reserve four times for one user. Assert slots 1, 2, and 3 are returned exactly once, all tokens differ, three documents exist, and the fourth call rejects with `MEMORY_PHOTO_QUOTA_FULL`. Assert non-positive/non-finite TTL and invalid dates are rejected before database writes.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: FAIL because `reservePhotoSlot` does not exist.

- [ ] **Step 3: Implement minimal atomic absent-slot reservation**

  Iterate slots 1–3, generate one token per call, and atomically insert/upsert only a missing owner/slot. Treat code `11000` as a lost concurrency race and continue; propagate unrelated database errors. Construct the complete valid reserved state explicitly and check returned state with `MemoryPhoto.assertState`.

- [ ] **Step 4: Write failing concurrent reservation tests**

  Launch at least six `reservePhotoSlot` calls with `Promise.allSettled`. Assert exactly three fulfill with distinct slots/tokens, remaining calls reject only with the quota code, and Mongo contains exactly three reserved documents. Add existing pending and approved slots and assert reservation never overwrites them.

- [ ] **Step 5: Extend reservation to atomically claim rejected or expired reserved slots**

  Use exact atomic predicates that match only `rejected` or `reserved` with `reservationExpiresAt <= now`. For rejected state, append one complete snapshot and reset every submission/review field. For expired reserved state, replace only token/expiry and retain existing history without appending. Do not rely on `countDocuments()` or Mongoose pipeline validation.

- [ ] **Step 6: Verify focused tests GREEN**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: all Tasks 1–3 tests pass, including concurrent quota assertions.

### Task 4: Token- and expiry-fenced completion

**Files:**
- Modify: `test/memoryPhoto.test.js`
- Modify: `service/memoryPhotoQuota.js`

**Interfaces:**
- Produces `completePhotoReservation({ photoId, ownerId, reservationToken, storageKey, now }) -> Promise<MemoryPhoto>`.
- Produces `MemoryPhotoReservationError` with stable codes `MEMORY_PHOTO_RESERVATION_STALE` and `MEMORY_PHOTO_RESERVATION_EXPIRED` as distinguishable service outcomes.

- [ ] **Step 1: Write failing successful-completion tests**

  Complete a live reservation and assert status `pending`, normalized non-empty `storageKey`, `submittedAt === now`, cleared token/expiry/review fields, and retained moderation history. Assert shared state validation accepts the result.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: FAIL because completion is not implemented.

- [ ] **Step 3: Implement atomic completion**

  Validate identifiers, token, key, and date before writing. Use one atomic predicate containing `_id`, `ownerId`, `status: "reserved"`, exact `reservationToken`, and `reservationExpiresAt: { $gt: now }`. Explicitly set pending fields and unset every reserved/review field, then run the shared validator on returned state. If no document matches, perform a read-only classification query to distinguish expired from stale without changing state.

- [ ] **Step 4: Add failing boundary and stale-token tests**

  Assert completion immediately before expiry succeeds; completion exactly at expiry and after expiry fails as expired and leaves the record reserved; wrong owner/token fails stale; after expired reservation is reclaimed with a new token, the old token cannot complete it.

- [ ] **Step 5: Add an invariant-postcondition test**

  Temporarily stub `MemoryPhoto.assertState` to throw after the atomic result and assert the service surfaces the invariant error, proving service transitions call the shared validator rather than relying only on `runValidators`. Restore the real function in `finally`.

- [ ] **Step 6: Verify focused tests GREEN**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: all Tasks 1–4 tests pass.

### Task 5: Release, expiration recovery, and rejected-state restoration

**Files:**
- Modify: `test/memoryPhoto.test.js`
- Modify: `service/memoryPhotoQuota.js`

**Interfaces:**
- Produces `releasePhotoReservation({ photoId, ownerId, reservationToken }) -> Promise<{ released: true }>`.
- Produces `recoverExpiredPhotoReservations({ now, ownerId? }) -> Promise<{ recovered: number }>`.
- Both use internal exact-token compare-and-set logic; recovery reads expired candidates but every mutation also matches candidate `_id`, owner, reserved status, captured token, and `reservationExpiresAt <= now`.

- [ ] **Step 1: Write failing release tests for new reservations**

  Assert a matching token deletes a new empty reservation, while a wrong/old token changes nothing and returns `MEMORY_PHOTO_RESERVATION_STALE`. Re-reserve the same slot and prove the old release token cannot delete it.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: FAIL because release is not implemented.

- [ ] **Step 3: Implement token-fenced release**

  For empty-history reservations, use atomic `findOneAndDelete`. For replacement reservations, use an atomic pipeline that restores the last history snapshot, removes exactly that final entry, clears reservation fields, and sets current `updatedAt` to operation time. Every predicate must include exact token and reserved status; validate returned restored state.

- [ ] **Step 4: Write failing rejected-replacement history tests**

  Create a rejected photo with fixed `submittedAt`, `reviewedAt`, reviewer, reason, storage key, `createdAt`, `updatedAt`, and one earlier history entry. Reserve its slot and assert the full current rejected state is appended once. Release it and assert current submission/review metadata is exactly restored, the earlier history is unchanged, the temporary appended snapshot is removed, and current `updatedAt` advances rather than being restored/backdated.

- [ ] **Step 5: Write failing successful-replacement history test**

  Reserve a rejected slot and complete it. Assert pending current state refers to the new key/submission time and the full previous rejection remains as the last history entry, including original submission/review timestamps and original document timestamps.

- [ ] **Step 6: Write failing expiration-recovery tests**

  Create expired new and replacement reservations plus one live reservation. Recover at `now`; assert the new expired record is removed, the expired replacement is restored exactly, the live reservation is untouched, and recovered count is two. Simulate a reservation being renewed after recovery reads candidates and assert the captured old token/expiry predicate cannot mutate the renewed reservation.

- [ ] **Step 7: Implement expiration recovery with exact compare-and-set operations**

  Query only candidate expired reservations, then call the same internal release/restore primitive with captured token and an additional `reservationExpiresAt <= now` predicate. Count only mutations that actually matched. Never delete storage objects.

- [ ] **Step 8: Verify focused tests GREEN**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: all focused tests pass with zero failures.

### Task 6: Full compatibility verification

**Files:**
- Inspect only: all Phase 1 changes and Git diff

**Interfaces:**
- Confirms Phase 1 is additive and existing application behavior remains unchanged.

- [ ] **Step 1: Run focused tests from a clean test process**

  Run: `node --test test/memoryPhoto.test.js`

  Expected: zero failures. If local `mongod` is unavailable, stop and report the exact limitation; do not use a remote database.

- [ ] **Step 2: Run the complete existing root suite**

  Run: `npm test`

  Expected: all existing and new root tests pass. Record every skipped or failed test by name and cause.

- [ ] **Step 3: Run static sanity checks**

  Run: `node --check model/memoryPhotosModel.js`, `node --check model/memoryPhotoLikesModel.js`, `node --check model/memoryPhotoSettingsModel.js`, `node --check service/memoryPhotoQuota.js`, and `node --check test/memoryPhoto.test.js`.

  Expected: every command exits 0.

- [ ] **Step 4: Inspect compatibility boundaries and whitespace**

  Run: `git diff --check`, `git diff --name-only`, and `git status --short`.

  Expected: no whitespace errors; changed paths are limited to the approved spec/plan and Phase 1 model, service, and test files; no existing runtime feature or configuration file is modified.

- [ ] **Step 5: Produce the Phase 1 report and stop**

  Report files, schemas/indexes, quota and token fencing, history restoration, recovery behavior, focused/full test evidence, unexecuted tests, risks, and exact `git status --short`. Do not proceed to routes, frontend, or S3 work.
