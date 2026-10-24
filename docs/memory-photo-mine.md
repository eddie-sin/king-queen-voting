# My Memories metadata

`GET /api/v1/memory-photos/mine` requires the existing Bearer JWT for an active
student User. ADMIN and MEMORY_ADMIN tokens are rejected. No query/body fields,
client-supplied owner IDs or pagination parameters are accepted.

Memory Photo must be enabled (`memoryPhotosEnabled === true`). False, missing
and absent Election settings return 403. The controller rechecks the setting
immediately before responding, and successful responses use private/no-store
caching with `Vary: Authorization`.

```json
{
  "status": "success",
  "results": 2,
  "data": {
    "photos": [
      { "id": "<newer photo ID>", "status": "PENDING", "createdAt": "2026-10-22T10:00:00.000Z" },
      { "id": "<older photo ID>", "status": "REJECTED", "createdAt": "2026-10-21T10:00:00.000Z" }
    ],
    "quota": { "limit": 3, "acceptedCount": 2, "remainingSlots": 1 }
  }
}
```

Photos belong only to the JWT's current User ID and are sorted by createdAt
descending, then `_id` descending for deterministic ties. PENDING, APPROVED and
REJECTED records all count as accepted lifetime submissions. Cancellation markers
are excluded by model middleware. Explicit field selection and response mapping
exclude image keys, locations, owner identities, reviewer IDs, review times and
internal fields. This endpoint neither retrieves image bytes nor grants student
access to pending/rejected images.

`acceptedCount` counts retained, non-cancelled submission records across all three
statuses. The existing application retains those records for lifetime history;
there is no student photo-delete API. `remainingSlots` conservatively subtracts
the distinct union of visible photo IDs and persisted quota slot IDs from three,
clamped to zero. This supports legacy photos without a quota document and does
not double-count accepted IDs already present in the ledger. In-flight or
unresolved reservations (including cancellation awaiting cleanup) may reduce
capacity without increasing acceptedCount. GET does not initialize, release or
recover quota entries. The upload endpoint remains the atomic authority and can
reject a request if another submission claims capacity after this read.

Keep accepted records for accurate lifetime history. If an operator manually
deletes one outside the supported API, its retained quota token still prevents
capacity from being restored, but this endpoint cannot reconstruct the deleted
record's metadata or distinguish that token from an unresolved reservation.

No frontend, AWS settings, quota-write semantics, moderation or public image
behavior changes are needed for this endpoint. Existing authentication and
`catchAsync`/`AppError` conventions apply. Focused tests use a fresh temporary
MongoDB instance and never load credential files or contact AWS.
