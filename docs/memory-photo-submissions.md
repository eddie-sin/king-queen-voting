# Memory Photo student submissions

## Request and response

`POST /api/v1/memory-photos` requires an active User Bearer JWT. Admin tokens are
rejected. In Postman, select Body > form-data, add exactly one File field named
`images`, and let Postman set the multipart Content-Type boundary. Do not add
owner, status, review metadata, or other body fields.

The existing Election setting `memoryPhotosEnabled` must be true. Missing settings
or a missing field mean disabled. The setting is checked before multipart parsing
and again after private storage, immediately before persistence. There is no
registration/voting/event-date gate on this endpoint.

Accepted files are JPEG, PNG or WebP, at most 5 MB, single frame, and at most
25 million pixels. Sharp decodes and re-encodes the image; corrupt content,
unsupported formats and mismatches with the declared MIME type are rejected.
This strips metadata and appended non-image content before private storage.

Successful responses use HTTP 201:

```json
{
  "status": "success",
  "data": {
    "photo": {
      "id": "<MongoDB photo ID>",
      "status": "PENDING",
      "createdAt": "<ISO timestamp>"
    }
  }
}
```

No image key, bytes, URL, owner account information or review fields are returned.
Errors use existing project response conventions: 400 for invalid files/body,
401 for missing/invalid user authentication, 403 for admins/disabled accounts or
feature, 409 for exhausted quota, and 503 for storage/persistence failures.

## Atomic lifetime allowance

`MemoryPhotoQuota` is a separate collection with one document per User, keyed by
the user's ObjectId. Its `slots` contains deterministic photo IDs for accepted
submissions and in-flight reservations. A single MongoDB findOneAndUpdate only
pushes a reservation when fewer than three slots exist. MongoDB's atomic document
update and unique `_id` enforce this across processes, without transactions,
replica sets, process locks or a count-then-insert quota check.

The first request initializes the quota with all existing MemoryPhoto IDs for
that owner, regardless of moderation status. Concurrent initializers cannot
replace an existing quota document. New submissions must go through this path;
direct database writes can bypass application guarantees.

PENDING, APPROVED and REJECTED accepted submissions occupy their slots forever.
Removing image bytes or a photo record does not free an accepted slot. Do not
reset/delete quota documents as part of future rejection or deletion handling.

Failed operations first durably cancel their deterministic photo ID. An upsert
in the MemoryPhoto collection leaves a permanent internal `cancelled: true`
marker with the same unique `_id`. If the original insert already committed,
it becomes cancelled; if the original insert arrives later, the marker blocks
it with a duplicate-key error. An acknowledged delete was insufficient: a late
insert could arrive after deletion and after its quota slot was released. This
fix supersedes the H1 late-insert finding in the historical pre-merge review.

Only after acknowledged cancellation may cleanup delete the private image and
pull that exact ID from the quota. Repeated cleanup cannot release another
request's slot. Reservations, accepted inserts, cancellations and releases use
majority write concern with journaling. Cancellation must return acknowledged;
an error or uncertain result retains the slot and image. Storage errors remain
generic to avoid leaking private keys or provider details.

Cancelled markers are not submissions: model queries used by moderation,
public listing, image delivery, likes and legacy quota initialization exclude
them. Raw collection access deliberately includes them for recovery. The MongoDB
physical collection can contain more than three documents per owner because
failed-operation markers remain, but there can be at most three accepted or
unresolved submissions through the upload path. Never delete/expire these
markers or reuse their IDs; doing so can revive a delayed insert.

## Failure recovery limits

This standalone MongoDB design does not make S3/filesystem writes and multiple
MongoDB documents one transaction. If rollback cannot be confirmed, the slot and
image remain reserved for reconciliation; they are not treated as a successful
submission. Failed quota release and image cleanup emit generic operational
messages. A process crash can also leave a reservation or an orphan image.
Reservations intentionally have no timeout: expiring one while its original
request can still commit would allow the limit to be exceeded.

Before reserving, the helper retries releases for slots whose photo IDs already
have cancellation markers. It re-confirms durable cancellation before pulling
each slot, so recovery works across server restarts and concurrent workers,
including a lost cancellation acknowledgement or failed quota release.
`recoverCancelled(owner)` can also run explicitly in trusted operational code.

Unknown reservations (including a crash before cancellation) stay reserved.
Age or absence of a photo does not prove the original insert cannot still arrive.
After explicitly identifying a failed operation, trusted operational code may
call `release(owner, photoId)`, which fences that ID before releasing it. Never
call it for an accepted submission. There is no public recovery endpoint or
background sweep. A crash or lost cancellation acknowledgement may leave private
orphan bytes for later storage reconciliation. Tombstones consume database space
and must be included in backups/restores with the quota and photo collections.

The tests inject delayed writes and lost acknowledgements against disposable
local MongoDB, including insert-before-cancel, insert-after-cancel, cancellation
failure, release failure, concurrent recovery and recovery in a fresh process.
They do not exercise real replica-set failover, network partitions or AWS. MongoDB
must support majority/journaled writes; an unavailable durability acknowledgement
fails closed. Direct database writes, deleting fences, or independently restoring
inconsistent quota/photo backups can bypass these application guarantees.
