# Memory Photo admin moderation

All endpoints below require an active staff Bearer JWT and remain available
regardless of `memoryPhotosEnabled`. Full `admin` accounts retain all access.
`memory_admin` accounts can always list submissions and retrieve their private
images; approving and rejecting require the corresponding `memory.approve` or
`memory.reject` grant. Ordinary User tokens are rejected. Only full `admin` may
provision staff. See [current role workspaces](role-workspaces-and-lantern-voting.md).

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/v1/admin/memory-photos` | List all non-cancelled records, newest first, with ID as a deterministic tie breaker |
| GET | `/api/v1/admin/memory-photos/:id/image` | Return private image bytes for authenticated review |
| PATCH | `/api/v1/admin/memory-photos/:id/review` | Set a PENDING photo's status to APPROVED or REJECTED |

Listing returns `{ status: "success", results, data: { photos: [...] } }`.
Photo metadata contains `id`, `owner`, `status`, `createdAt` and any review
metadata. Storage keys and public URLs are never returned. The moderation history
contains PENDING, APPROVED and REJECTED records. The administrator interface shows
their status and disables approval/rejection controls for every non-PENDING item.
Cancellation fencing markers are never returned.

Image retrieval returns JPEG, PNG or WebP content directly, with
`Cache-Control: private, no-store`, `Vary: Authorization`, and
`X-Content-Type-Options: nosniff`. Local Buffers and production S3 streams are
supported. Admins can also retrieve already reviewed photos. Public retrieval
is separately restricted to APPROVED photos while the feature is enabled; images
retain private storage after approval or rejection. Missing records/objects return 404; storage availability errors return
a generic 503. A stream failure after delivery starts closes the connection.

For a review, send exactly one JSON field:

```json
{ "status": "APPROVED" }
```

Use `REJECTED` for rejection. Other statuses, extra fields, missing status and
malformed IDs return 400. Missing photo records return 404. Repeated reviews
return 409. A conditional MongoDB update matches only PENDING records and writes
the decision, authenticated admin ID and server review timestamp together, so
only one simultaneous review can succeed. The response is
`{ status: "success", data: { photo: ... } }` with HTTP 200.

Reviewing never changes quota documents, deletes submission records, deletes
image content, or grants public storage access. Rejected photos continue to count
toward the three-submission lifetime limit. See [public gallery behavior](memory-photo-public-gallery.md)
for approved-photo delivery and [likes behavior](memory-photo-likes.md) for user reactions.
