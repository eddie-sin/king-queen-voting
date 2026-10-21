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

`MEMORY_PHOTO_STORAGE` accepts exactly `local` or `s3`. When unset, production
uses S3 and other modes use local files, preserving the existing defaults.
An empty or invalid value fails with 503 rather than silently switching storage.
The selector applies to uploads, retrieval and deletion. It changes neither
MongoDB selection nor candidate/gallery storage. Restart after changing settings;
there is no automatic migration or fallback for existing objects in another store.

For development with local MongoDB and S3-backed Memory Photos, configure these
nonsecret values privately alongside the existing application configuration:

```dotenv
NODE_ENV=development
DATABASE_LOCAL=mongodb://127.0.0.1:27017/king-queen-memory-s3-test
MEMORY_PHOTO_STORAGE=s3
AWS_REGION=<actual-bucket-region>
AWS_S3_BUCKET=thadinkyut-voting-images-2026
AWS_MEMORY_PHOTO_BUCKET=thadinkyut-voting-images-2026
MEMORY_PHOTO_ALLOW_SHARED_BUCKET=true
```

Use a disposable local database and generated test accounts. `npm run dev` still
uses `DATABASE_LOCAL`; public images remain local under `/uploads`. Existing
JWT/admin setup still applies. AWS authentication uses the existing SDK credential
chain (prefer an IAM role; local temporary credentials may use
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`). Never commit
credential values. `AWS_S3_PUBLIC_URL` remains optional for public images and is
never used to construct a Memory Photo URL.

`getImage` returns `{ body, contentType, contentLength }`, with a Buffer locally
and an AWS SDK response stream in production. This is an internal server helper,
not an authenticated endpoint. Moderation controllers enforce ADMIN/MEMORY_ADMIN
authorization; the public controller enforces enabled/APPROVED checks. Image
responses set private/no-store caching headers and X-Content-Type-Options: nosniff.
No public or signed URL is generated.

## Production and AWS requirements

Local regression tests use mocked S3 operations and require no AWS requests.
A controlled live check is recorded below; it does not replace deployment-time
policy verification or prove all possible access paths remain private. Before
production rollout, verify the following configuration in the deployment account.

Configure `AWS_REGION` and `AWS_MEMORY_PHOTO_BUCKET`. A separate private bucket
remains the recommended default. The helper never falls back to `AWS_S3_BUCKET`,
a CDN or local files after an S3 failure. Using the same bucket as `AWS_S3_BUCKET`
is rejected unless `MEMORY_PHOTO_ALLOW_SHARED_BUCKET` is exactly `true`.
Unset or `false` prohibits sharing; all other values (including empty, `TRUE`
and `1`) fail with 503 when private S3 storage is used. The flag is permission
to use the configured bucket, not evidence that its AWS policies are safe.

Private writes omit ACLs and grant headers and set Cache-Control to private,
no-store. Omitting ACLs supports Bucket owner enforced Object Ownership.
However, omitting an ACL or hiding a URL cannot override a bucket/access-point
policy or a public CDN that grants access. Enable all S3 Block Public Access
settings on the dedicated bucket, use Bucket owner enforced ownership, remove
public access policies, and do not expose this bucket through a public CDN.
Grant the backend role only the required s3:PutObject, s3:GetObject and
s3:DeleteObject access to the memory-photos/* prefix. AWS settings are not
inspected or changed by these helpers or their mocked tests.

## Shared-bucket policy requirements

S3 folders are prefixes, not security boundaries. A public `s3:GetObject` allow
on `arn:aws:s3:::thadinkyut-voting-images-2026/*` exposes Memory Photos too,
regardless of moderation status, opaque keys, absent ACLs or no-store headers.
Before enabling sharing, replace every broad public read grant with grants only
for the intended public prefixes. For example, the public-read statement may be:

```json
{
  "Sid": "PublicCandidateAndGalleryImagesOnly",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": [
    "arn:aws:s3:::thadinkyut-voting-images-2026/candidates/*",
    "arn:aws:s3:::thadinkyut-voting-images-2026/gallery/*"
  ]
}
```

This is a statement to review within the existing policy, not a complete policy
or a statement to append while leaving a broad public allow in place. Preserve
unrelated statements and existing candidate/gallery behavior. Never grant public
read/write/list access to `memory-photos/*`. Audit existing object ACLs, access
points and website/CDN distributions as well: an authorized CDN with a public
viewer endpoint can expose this prefix even without an anonymous S3 grant.
Use Bucket owner enforced ownership where compatible; otherwise verify that no
existing Memory Photo object has a public ACL. Review changes before applying
bucket-wide Block Public Access settings, since those can break existing public
candidate/gallery URLs. A dedicated private bucket avoids this mixed-policy risk.

The backend IAM role needs this additional identity-policy statement (preserve
its existing public-image permissions separately):

```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
  "Resource": "arn:aws:s3:::thadinkyut-voting-images-2026/memory-photos/*"
}
```

No `s3:PutObjectAcl`, bucket administration or `s3:ListBucket` permission is
required by these helpers. With SSE-KMS, grant the appropriate key-policy/IAM
permissions, including `kms:GenerateDataKey` and `kms:Decrypt`; bucket policies
requiring explicit encryption request headers need separate compatibility review.
Use only trusted principals for this prefix. Approved images must still be served
through backend feature/status checks; do not change the prefix to public after
approval, since public access would bypass the feature-disable setting.

Before real submissions, separately verify signed backend upload/get/delete,
anonymous denial of a known Memory Photo object through S3 and every CDN, and
continued public access to candidate/gallery objects. These are deferred live
deployment checks except for the explicitly recorded live results below, not
assertions made by the local mocked tests. No runtime
bucket-policy inspection is performed and unsafe AWS policies cannot be repaired
by the opt-in flag.

## Controlled live S3 verification — 2026-10-21

The minimal workflow used an isolated development Express instance, the local
`king-queen-memory-s3-test` MongoDB database, generated STUDENT/ADMIN/MEMORY_ADMIN
accounts, and one non-sensitive 4x4 PNG. The existing Postman collection supplied
the request contract; the full 76-request collection was not run. The configured
backend identity authenticated through STS. No credentials, passwords or tokens
are included in this evidence.

The user supplied these manual security checks before authorizing uploads:

- Anonymous bucket-policy reads are limited to `candidates/*` and `gallery/*`.
- Object Ownership is Bucket owner enforced, with ACLs disabled.
- No general-purpose access points exist in ap-southeast-1; no CloudFront
  distributions exist.
- A harmless `memory-photos/test.txt` object returned AccessDenied through an
  unauthenticated direct S3 URL. That existing object was not modified by the run.

These are user-reported manual findings, not independently fetched policy
evidence: earlier attempts to read bucket/account policy metadata returned 403.
They are time-specific and do not establish the safety of future policy changes.

| Check | Recorded result |
| --- | --- |
| Backend HTTP requests, including final feature disable | 20 passed, 0 failed |
| Explicit assertions | 45 passed, 0 failed |
| Upload | HTTP 201 PENDING; confirmed object under `memory-photos/`, no public ACL/grant headers |
| S3 operations | 1 acknowledged PutObject, 2 successful GetObject, 1 successful HeadObject, 1 acknowledged DeleteObject |
| Pending privacy | Public Express image returned 404; direct anonymous S3 returned 403 AccessDenied |
| Moderation | MEMORY_ADMIN retrieved and approved the image; review audit matched that administrator |
| Approved delivery | Public Express returned matching private image bytes with no-store; direct anonymous S3 remained 403 |
| Permissions | Student denied private moderation; MEMORY_ADMIN denied feature toggle |
| Likes | Repeated like/unlike calls were idempotent with expected counts |
| Feature disabled | Public image returned 403 |
| Post-delete absence | UNVERIFIED: follow-up HeadObject returned 403; runner exited nonzero for this verification gap |

The test-only SDK guard required `If-None-Match: *` on its upload to prevent
overwriting an existing object, recorded the acknowledged object key, and allowed
object operations only for that run's confirmed key. This was test instrumentation,
not a change to application upload behavior. Candidate/gallery objects were not
read, written or deleted, so their continued live availability was not retested.

Cleanup disabled Memory Photo, removed generated database records/accounts and
temporary files, and stopped the isolated server. S3 acknowledged deletion of
the created object, but absence was not independently confirmed. AWS documents
that missing-object HeadObject returns 403 without `s3:ListBucket`; this is a
possible explanation, not proof of absence. A reviewer with suitable read/list
visibility can verify cleanup separately. Do not weaken privacy settings or
grant broad permissions merely to turn this response into 404.

No production database, AWS security policy or Git history was changed by the
live run. No further object operations were attempted after the 403 verification
gap. Version-history/lifecycle behavior and other delivery paths remain separate
deployment considerations.

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
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
