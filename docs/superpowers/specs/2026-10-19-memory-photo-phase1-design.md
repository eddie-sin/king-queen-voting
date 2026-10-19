# Memory Photo Phase 1 Design

## Scope

Phase 1 adds persistence and service-level domain behavior for Memory Photo submissions. It introduces MongoDB models, atomic reservation/quota operations, and focused automated tests. It does not add routes, UI, upload transport, S3 operations, migrations, or deployment changes, and it does not alter the existing election schedule or existing voting, authentication, candidate, or gallery behavior.

## Data model

### MemoryPhoto

Each account has at most one persistent document for each slot numbered 1 through 3. The document contains:

- `ownerId`: required reference to `User`.
- `slot`: required integer in the inclusive range 1–3.
- `storageKey`: nullable string; absent while a reservation has not completed.
- `status`: one of `reserved`, `pending`, `approved`, or `rejected`.
- `reservationToken`: a cryptographically random identifier present only while reserved.
- `reviewedBy`: optional reference to `Admin`.
- `reviewedAt`: optional date.
- `rejectionReason`: optional trimmed string.
- `reservationExpiresAt`: present only while reserved.
- `submittedAt`: set when a reservation successfully completes and retained through moderation. This is separate from the persistent slot document's `createdAt`, so replacement submissions have an accurate original submission timestamp.
- `moderationHistory`: embedded snapshots of previous rejected submissions. A snapshot stores only the prior storage key, status, review administrator, original submission time, review time, rejection reason, and the relevant original document timestamps. It never stores image bytes.
- Mongoose timestamps `createdAt` and `updatedAt`.

A unique compound index on `{ ownerId: 1, slot: 1 }` is the hard quota boundary. Schema validation enforces status invariants:

- `reserved`: no storage key, submission time, or review fields; requires reservation token and reservation expiry.
- `pending`: requires a storage key and submission time; has no active reservation or review fields.
- `approved`: requires a storage key, submission time, reviewer, and review time; has no rejection reason or active reservation.
- `rejected`: requires a storage key, submission time, reviewer, review time, and non-empty rejection reason; has no active reservation.

The same explicit state-invariant function is used by document validation and by service transition construction. Atomic service operations set and unset every status-dependent field deliberately, validate transition inputs before issuing the write, and validate returned state as a postcondition. Update pipelines are not treated as automatically protected by Mongoose update validators; pipeline expressions and atomic predicates are responsible for preserving invariants, with the shared validator detecting programming errors and corrupt pre-existing state.

### MemoryPhotoLike

The like model contains required references `userId` and `photoId` plus `createdAt`. A unique compound index on `{ userId: 1, photoId: 1 }` prevents duplicate likes at the database boundary. Phase 1 adds no HTTP endpoints.

### MemoryPhotoSettings

A singleton settings document uses the fixed string `_id` `"memory-photo-settings"` and contains `enabled`, `opensAt`, `uploadsCloseAt`, `likesCloseAt`, and `galleryClosesAt`. The fixed identifier guarantees one authoritative configuration record. It defaults to disabled with every timestamp null. Enabling requires a configured `opensAt`. Every configured closing timestamp must be later than `opensAt`; closing timestamps are otherwise independent because no ordering between the three closing events was specified.

October 25, 2026 in `Asia/Yangon` is planning context only. Because the exact time is undecided, no timestamp is seeded or invented, and the existing election schedule remains untouched.

## Reservation and quota service

The service exposes focused operations for reserving, completing, releasing, and recovering expired reservations. Callers receive a reservation token and must supply that same token for every later mutation.

### Reserve

For slots 1 through 3, reservation attempts use atomic MongoDB operations:

1. Atomically claim an existing rejected slot or an expired reserved slot without matching pending or approved records.
2. Otherwise attempt to insert a new reserved document for that owner and slot.
3. Treat duplicate-key errors as a concurrent winner and continue to the next slot.
4. Return a quota error only after all three indexed slots are unavailable.

When a rejected slot is claimed, its full rejected state is appended once to `moderationHistory` in the same atomic update before current submission fields are reset. When an expired replacement reservation is reclaimed, the existing saved rejected snapshot is retained without appending it again.

### Complete

Completion changes `reserved` to `pending`, sets the storage key and `submittedAt`, and clears the token and expiry. The atomic predicate includes document identity, `status: reserved`, the exact reservation token, and `reservationExpiresAt > now`. A stale or expired completion therefore cannot affect a replacement reservation, even if expiration cleanup has not run.

### Release and expiration recovery

Release and recovery use the same token-fenced atomic rules:

- A new slot reservation with no prior rejected snapshot is deleted only if its current token matches.
- A replacement reservation restores the most recent rejected snapshot into the current fields and removes that one snapshot from `moderationHistory`, returning the document's submission and review metadata exactly to its pre-reservation state without duplicating or losing earlier history. The recovery write uses the current operation time for the document's `updatedAt`; it does not backdate `updatedAt`.
- Expiration recovery additionally requires `reservationExpiresAt <= now`; stale cleanup cannot release a newer reservation.

No operation deletes image objects. Previous rejected storage keys remain represented either in the restored current record or in moderation history.

## Concurrency and failure behavior

The compound slot index, atomic predicates, and unique reservation tokens provide defense in depth:

- Concurrent requests cannot create a fourth slot.
- Duplicate-key races are expected and handled without surfacing raw database errors.
- Pending and approved documents never match replacement predicates.
- Old completion, release, or cleanup calls cannot mutate a newer reservation.
- An expired reservation cannot complete before cleanup because completion checks its expiry atomically.
- Failed and expired reservations become reclaimable without deleting moderation history.
- Service-authored atomic transitions preserve schema invariants by construction and are checked with the shared state validator rather than relying only on Mongoose update validators.

The design does not use `countDocuments()` as the quota authority and does not require multi-document transactions, preserving compatibility with the repository's standalone MongoDB test setup.

## Tests

Focused Node.js tests will start a disposable local standalone `mongod`, use an isolated temporary database, build the relevant indexes, and remove the database afterward. They cover:

- valid and invalid documents for every status;
- settings disabled-by-default and chronological validation;
- three-slot quota and compound uniqueness;
- simultaneous reservation attempts;
- rejected replacement and successful history retention;
- approved and pending replacement restrictions;
- token-fenced completion and release;
- rejection of completion at or after reservation expiry, before cleanup;
- failed/expired reservation recovery and exact rejected-state restoration;
- restoration of original submission/review timestamps and preservation of earlier moderation history while allowing recovery to advance `updatedAt`;
- unique-like enforcement.
- fixed-ID settings singleton behavior and rejection of alternate settings identifiers through the model interface.

If local `mongod` is unavailable, integration tests will be reported as not executed. No remote or production database fallback is permitted.

## Compatibility boundaries

All implementation files are additive: three model files, one service file, and focused tests. Existing routes, application wiring, seed logic, election settings, upload middleware, gallery model, S3 helper, frontends, and existing feature controllers remain unchanged.
