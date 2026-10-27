# Live Memory Photo storage and refresh behavior

The deployed website and every backend using the same Atlas v2 data must use:

```dotenv
MEMORY_PHOTO_STORAGE=s3
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=thadinkyut-voting-images-2026
AWS_MEMORY_PHOTO_BUCKET=thadinkyut-voting-images-2026
MEMORY_PHOTO_ALLOW_SHARED_BUCKET=true
```

Keep private credentials in the existing protected configuration; never copy them into Git. Restart a backend after changing its configuration. Local storage remains appropriate for a separate disposable local database; never mix local files or another bucket with the shared live database.

The shared bucket grants anonymous reads only to `candidates/*` and `gallery/*`. `memory-photos/*` remains private. MongoDB collection access does not control S3 object access. The EC2 role has GetObject, PutObject and DeleteObject access limited to the necessary image prefixes. Approved images are delivered through the application's approval/feature checks; pending originals and archived images are not public S3 objects.

On October 27 the referenced image files were reconciled into the shared bucket and verified without changing photo IDs, moderation, accounts, likes or votes. The two source objects in the former dedicated bucket were retained for recovery. EC2 upload/read/delete was checked using one temporary synthetic image, removed afterward. No OTP email is required by these checks.

Gallery and My Memories metadata still refresh every 30 seconds and on window focus. Revalidation of the same page/account keeps loaded photo elements and a valid enlarged viewer in place. New metadata updates counts and statuses. A changed page/account, unavailable feature, failed metadata response, or removed/revoked selected photo clears the appropriate view. No persistent image cache or public S3 URL bypass was introduced. Manual image retry retries failed cards; the enlarged viewer also offers an explicit retry.

`npm --prefix frontend run test:memory-refresh` checks the real React pages with intercepted APIs in Chromium and WebKit on desktop/mobile, including focus/timer refresh, image-node preservation, viewer retention, status changes, access revocation, account switching, stale responses, logout and failed-image retry. It uses no real accounts, emails or AWS objects and is part of local and CI verification.
