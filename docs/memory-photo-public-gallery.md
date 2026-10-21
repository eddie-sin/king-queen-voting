# Public Memory Photo gallery

Both endpoints are anonymous and check `memoryPhotosEnabled === true` on every
request. False, missing fields and missing settings deny access with HTTP 403.
No registration or voting schedule applies.

## Gallery listing

`GET /api/v1/memory-photos?page=1&limit=20` returns only APPROVED photos, newest
first with descending ID as a deterministic tie breaker. Page defaults to 1 and
is limited to 1–1000; limit defaults to 20 and is limited to 1–50. Invalid values,
duplicate parameters and other query fields return 400. Pagination uses bounded
offsets; new submissions/approvals between requests may shift page contents.

```json
{
  "status": "success",
  "results": 1,
  "pagination": { "page": 1, "limit": 20, "hasMore": false },
  "data": {
    "photos": [{ "id": "<photo ID>", "createdAt": "<ISO timestamp>", "likeCount": 0 }]
  }
}
```

Metadata is explicitly limited to ID, creation time and likeCount. Counts are
aggregated from stored likes for only the photos on the requested page; photos
without likes return zero. No cached counter can drift from like records.
Owner, reviewer, review time, image keys, storage paths and URLs are never exposed.

## Image delivery

`GET /api/v1/memory-photos/:id/image` serves APPROVED bytes through the backend.
PENDING, REJECTED and nonexistent records all return 404 without reading storage.
Malformed IDs return 400. Content-Type is image/jpeg, image/png or image/webp;
Content-Disposition is inline and X-Content-Type-Options is nosniff. Buffers and
private S3 response streams are supported without redirects or public S3 URLs.
Missing objects return 404; provider failures return a generic 503.

The feature and approval state are checked before storage access and again just
before delivery. Admin review endpoints remain available while the public
feature is disabled; approval never changes an object's private storage policy.

## Caching and disabling

All public feature responses, including errors, use
`Cache-Control: private, no-store, max-age=0, must-revalidate`, `Pragma: no-cache`
and `Expires: 0`. Image responses have no ETag or Last-Modified validators and
never return a conditional 304. Conditional/range requests still require current
feature and approval checks; supported requests return the full image.

Disabling prevents subsequent requests from retrieving images, including
requests that reuse previous conditional headers. It cannot retract bytes already
downloaded or stop someone saving a public approved image. A stream already being
delivered may finish; a stream failure closes the connection. Deployment proxies,
CDNs and service workers must honor no-store and must not override these headers.
The private bucket remains private; do not expose it through a public static host.
