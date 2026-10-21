# Private Memory Photo storage

`utils/memoryPhotoStorage.js` exports `uploadImage(file)`, `getImage(key)`, and
`deleteImage(key)`. Uploads accept the existing Multer in-memory file shape,
JPEG/PNG/WebP MIME types, and at most 5 MB per image. MIME checks do not verify
image contents at the storage layer. The submission endpoint additionally
decodes and re-encodes content with Sharp. `middleware/upload.js` exports
`memoryPhotoImages` for multipart requests using `images` (one per request).
See [submission behavior](memory-photo-submissions.md) for authentication,
feature gating and MongoDB-backed lifetime reservations.

Uploads return only `memory-photos/<random-uuid>.<extension>` for `imageKey`.
Keys are restricted to this generated format; public gallery keys, URLs and
arbitrary filesystem paths cannot be read or deleted through this helper.

## Local development

Files default to `private-memory-photos/` beside the public upload directory.
`MEMORY_PHOTO_UPLOAD_DIR` optionally selects another private directory. Storage
rejects directories within public uploads, including resolved directory links.
Keep private directories controlled by the server's operating-system account,
outside any other web-server static roots. Custom storage directories must also
be excluded from source control and deployed backups handled appropriately.

`getImage` returns `{ body, contentType, contentLength }`, with a Buffer locally
and an AWS SDK response stream in production. This is an internal server helper,
not an authenticated endpoint. Moderation controllers enforce ADMIN/MEMORY_ADMIN
authorization; the public controller enforces enabled/APPROVED checks. Image
responses set private/no-store caching headers and X-Content-Type-Options: nosniff.
No public or signed URL is generated.

## Production and AWS requirements

This is a **deferred deployment requirement**, not a completed live integration
check. No AWS requests are needed for local regression tests. Before production
rollout, verify the following configuration in the deployment account and run
separate authorized S3 upload/get/delete and anonymous-denial smoke tests.

Configure `AWS_REGION` and a dedicated `AWS_MEMORY_PHOTO_BUCKET`. The helper
does not fall back to the public gallery bucket, CDN or local files. Using the
same name as `AWS_S3_BUCKET` is rejected. Existing AWS credential resolution is
reused; no credentials are stored in source files.

Private writes omit ACLs and grant headers and set Cache-Control to private,
no-store. Omitting ACLs supports Bucket owner enforced Object Ownership.
However, omitting an ACL or hiding a URL cannot override a bucket/access-point
policy or a public CDN that grants access. Enable all S3 Block Public Access
settings on the dedicated bucket, use Bucket owner enforced ownership, remove
public access policies, and do not expose this bucket through a public CDN.
Grant the backend role only the required s3:PutObject, s3:GetObject and
s3:DeleteObject access to the memory-photos/* prefix. AWS settings are not
inspected or changed by these helpers or their mocked tests.

## Cleanup

`deleteImage` removes the local file or calls S3 DeleteObject. Missing files are
safe to delete repeatedly; permission/network errors propagate for the caller
to handle or retry. Call it with a returned key after a failed database save,
or for future rejection/deletion handling. Do not remove submission records
merely because their bytes are deleted: rejected submissions still count toward
the future lifetime allowance. A failed upload that never returned a key or an
interrupted process may need separate orphan reconciliation.

In a versioned S3 bucket, DeleteObject creates a delete marker rather than
erasing historical versions. Configure a suitable noncurrent-version lifecycle
policy if permanent cleanup is required; Object Lock/retention may also prevent
permanent removal.

AWS references:

- https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/granting-public-access.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html
