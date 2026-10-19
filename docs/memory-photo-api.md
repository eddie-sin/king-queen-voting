# Memory Photo Backend API

Base path: `/api/v1`. User and admin authentication uses the existing `Authorization: Bearer <JWT>` header. Memory Photo starts disabled and no opening timestamp is seeded.

## Event settings

- `GET /memory-photos/settings` — public configuration state.
- `GET /admin/memory-photos/settings` — admin configuration state.
- `PATCH /admin/memory-photos/settings` — admin only. Accepts any subset of `enabled`, `opensAt`, `uploadsCloseAt`, `likesCloseAt`, and `galleryClosesAt`. Dates are ISO-8601 timestamps or `null`.

The exact event times remain an event-team decision. Enabling requires `opensAt`; each closing timestamp must be later than it. Uploads, likes, and the public gallery fail closed unless their corresponding closing timestamp is configured and the current time is inside `[opensAt, closesAt)`.

## User photos

- `GET /memory-photos/me` — authenticated user. Returns slots 1–3. Unused slots have `status: "empty"`; submissions use `pending`, `approved`, or `rejected`. Rejected entries include `rejectionReason`.
- `POST /memory-photos` — authenticated user, during the upload window. Send `multipart/form-data` with exactly one file under `photo`. JPEG, PNG, and WebP are accepted, maximum 5 MiB input. Images are normalized to static metadata-free WebP. HEIC is rejected with a user-facing message.
- `POST /memory-photos/:id/access` — owner only. Returns a five-minute private access grant for the current image.

Successful upload (`201`):

```json
{
  "status": "success",
  "data": { "photo": { "id": "...", "slot": 1, "status": "pending", "submittedAt": "...", "reviewedAt": null } }
}
```

An ambiguous storage/database outcome returns `202` with `outcome: "uncertain"` and an opaque `uploadId`. Pending and approved slots cannot be replaced. Rejected slots can be reused and retain moderation history.

## Administration

- `GET /admin/memory-photos/pending` — admin only; lists pending submissions and owner identity.
- `POST /admin/memory-photos/:id/access` — admin-only private preview grant.
- `PATCH /admin/memory-photos/:id/review` — admin only. Body is `{ "status": "approved" }` or `{ "status": "rejected", "rejectionReason": "1–500 characters" }`. Only a pending photo can transition.

## Public gallery and likes

- `GET /memory-photos/gallery?limit=20&after=<cursor>` — public during the gallery window. Returns approved photos only, with `likeCount`; storage keys are never returned. `limit` defaults to 20 and is capped at 50. Use `data.nextCursor` for the next page.
- `POST /memory-photos/gallery/:id/access` — public during the gallery window, approved photos only; returns a five-minute private read grant.
- `POST /memory-photos/:id/likes` — authenticated user during the likes window. Idempotently likes an approved photo and returns `liked: true` plus `likeCount`.
- `DELETE /memory-photos/:id/likes` — authenticated user during the likes window. Idempotently unlikes and returns `liked: false` plus `likeCount`.

Local grants contain an application URL under `/api/v1/memory-photos/files/:token`; S3 grants contain a short-lived presigned URL. Clients must treat either as temporary.

## Error responses

Errors use the existing shape `{ "status": "fail|error", "message": "..." }`.

- `400` — invalid ID/body, unsupported or malformed image, missing file, invalid rejection reason.
- `401` — missing or invalid JWT.
- `403` — wrong role, disabled/closed event window, invalid or expired local grant.
- `404` — photo is absent, belongs to another owner, or is not approved where approval is required. Owner checks deliberately avoid revealing whether another account's photo ID exists.
- `409` — all three slots are occupied or immutable storage content conflicts.
- `429` — another upload for the same account is still in progress.
- `503` — private storage could not be safely verified.

Private S3 configuration and environment-variable names are listed in `config.example.env`. Existing candidate/gallery storage remains separate.
