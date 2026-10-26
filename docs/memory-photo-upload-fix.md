# Memory Photo upload investigation

## Finding

The production configuration selects the Atlas v2 database and S3-backed Memory
Photo storage. The configured event controls had `memoryPhotosEnabled` disabled
at the time of the reported browser session. The student history endpoint is
therefore expected to return `403`; the Upload Studio used that state to disable
its file inputs. A user could not even create a local preview, so no multipart
request was sent and the server-side lifetime allowance correctly remained at
three.

This is separate from the secure-cookie session migration: the frontend keeps a
short-lived in-memory session marker while credentials remain HttpOnly cookies,
and the API adapter does not send bearer tokens.

## Fix

`frontend/src/memory/ConnectedUpload.jsx` now permits up to three local previews
while the allowance is loading, disabled, unavailable, or the user is signed
out. The preview URLs remain local, are revoked on removal/unmount/session
change, and cannot be submitted until an active session has loaded a server
quota. Once the quota is ready, selection is bounded by `remainingSlots` as
before. Uploads still use the existing sequential FormData requests and the
backend remains the source of truth for feature state, quota reservation and
private storage.

## Reproduction

1. Run the production frontend against the configured backend.
2. Leave Memory Photo disabled in EventControls.
3. Open `#memory-upload` while signed in as a student.
4. Before this fix, the chooser was disabled and the three slots stayed empty.
5. After this fix, a supported local image renders in a slot, while submission
   remains unavailable until an administrator enables Memory Photo.

## Verification

- Backend v2 regression: 113/113 passed on disposable local replica-set data.
- Frontend unit tests: 43/43 passed.
- Frontend production build: passed (81 modules).
- Wish Sky live browser flow: passed against disposable local data.
- Real Atlas/S3 writes were not performed: the configured shared bucket is an
  external resource and live privacy/ownership verification is intentionally
  deferred.

## Remaining limitation

The production operator must enable Memory Photo before a student can submit.
Local previews are deliberately not persisted and do not consume a lifetime
slot. The existing legacy upload browser mock still needs its harness updated
to seed the current in-memory session marker; the real browser journey and
unit/API tests cover the current secure-cookie contract.
