# Memory Photo: local Postman end-to-end guide

Source inspected on branch `feature/memory-photo`. This guide and collection
describe the implemented API, including dedicated Memory Admin authorization.

## Files and local setup

- Import [the collection](../postman/Memory-Photo.postman_collection.json).
- Import [the blank environment](../postman/Memory-Photo.local.postman_environment.json).
- Upload requests use [this valid PNG](../postman/fixtures/memory-photo.png).

Use a dedicated **local test database**, a full ADMIN account and a **fresh User
account with no prior submissions**. The run provisions a new MEMORY_ADMIN,
saves three photos, permanently
consumes that student's allowance, approves the first, rejects the other two,
and leaves Memory Photo disabled. It also creates, updates and removes an isolated
contestant, and creates/removes an old-gallery image record to verify full ADMIN
permissions. Existing gallery deletion removes metadata, not the underlying file;
the isolated validation environment removes all temporary files on exit.
It is not safe to repeat with the same student
and expect the same results. Do not run it against real event data.

From the repository root:

```powershell
npm ci
npm run dev
```

Before starting, configure the ignored `config.env` privately using the project's
existing setup process: `DATABASE_LOCAL` for the dedicated database, `JWT_SECRET`,
and `ADMIN_USERNAME`/`ADMIN_PASSWORD` for first-time admin seeding. The default
port is 5000. Do not paste values into this guide, source control or shared
Postman exports. Initial admin values are used only when no admin exists;
changing them does not reset an existing admin's password.

Development saves images locally; no AWS configuration is needed. The private
directory must be outside `LOCAL_UPLOAD_DIR`. Production instead requires
`AWS_REGION` and a separate `AWS_MEMORY_PHOTO_BUCKET` with private access policy.
See [storage setup](memory-photo-storage.md). Local tests do not prove live AWS
permissions or policy correctness.

Create the fresh test student before running the collection. In Postman send
`POST {{base_url}}/api/v1/auth/register`, **No Auth**, raw JSON:

```json
{ "email": "{{student_email}}", "password": "{{student_password}}" }
```

Supply a new test email and private password (at least eight characters) in the
environment first. Expect 201. Registration returns a one-time voting key but
does **not** log in; Memory Photo does not use that key. Registration is subject
to the existing `registrationClosesAt` setting; 403 means registration is closed,
and 409 means the email already exists. Use an existing *unused* account or a
fresh local database if necessary; do not change event dates as part of this run.

## Import and run

1. Select the imported local environment. Set `base_url` without a trailing
   slash or `/api/v1` (the blank template uses `http://localhost:5002`), `admin_username`,
   `admin_password`, `student_email`, `student_password`, `memory_admin_username`,
   and `memory_admin_password` privately in Postman. Use a new moderator username
   each run; provisioning rejects duplicates.
   The supplied JSON contains no account credentials or tokens.
   Match base_url to the server's printed port; the backend defaults to 5000
   unless PORT is configured privately.
2. Set Postman's working directory to this repository root. Upload requests
   reference `postman/fixtures/memory-photo.png`. If your Postman version cannot
   resolve the path, select this file in each upload request's `images` File
   field, including expected-error uploads. Do not set multipart Content-Type
   manually: Postman supplies the boundary. No extra form fields are accepted.
3. Use the desktop app or Desktop Agent for localhost. Run the **whole collection
   in order**, one iteration, with the selected environment. Keep the target
   isolated and ensure voting has not started (the existing permanent contestant
   lock must be false) for the full-admin contestant checks. Do not move real
   event dates or unlock real contestants just to run this test. Exact 0/1 like assertions assume nobody else likes this new photo,
   and page-one assertions assume no competing influx of new approvals.
4. Login scripts store tokens and chained IDs with `pm.variables`, scoped to the
   current run. They do not log secrets or write tokens into exported files.
   Login bodies are JSON-encoded at runtime so special characters in passwords
   do not break the JSON. Every negative request asserts its expected error.
5. An unexpected HTTP status stops the remaining sequence. Inspect failed
   assertions; do not blindly rerun uploads. A partial run may leave the feature
   enabled and some lifetime slots consumed. The last folder normally disables
   it. Never export filled environments, login responses, runner data, or console
   output containing credentials/tokens; `type: secret` masks values but does not
   encrypt an exported file.

For individual **Send** requests instead of the Runner, runtime variables are
not a durable cross-request store. Log in, manually put `data.token` into the
   matching *private local* `admin_token`, `memory_admin_token` or `student_token` environment field, and
copy photo IDs from upload responses into `photo_id`, `rejected_photo_id` and
`pending_photo_id` as needed. Set `student_id` from login `data.user.id`. Clear
these values after testing. Each request explicitly chooses Admin, Student or
No Auth; anonymous checks do not inherit a Bearer token.

## Exact sequence and expected results

All paths below start with `/api/v1`. IDs are captured from responses, never
guessed from the admin queue. `images` is exactly one multipart File per request.

| Stage | Requests and body | Authentication | Expected result |
| --- | --- | --- | --- |
| 1 | Full admin/student login; `POST /admin/memory-admins` with `username,password`; moderator login at `/auth/admin/login` | No Auth logins; ADMIN provisioning | Login 200, provisioning 201; moderator login reports `data.admin.role: MEMORY_ADMIN` |
| 2 | `PATCH /admin/settings` with `{"memoryPhotosEnabled":true}`; `GET /settings` | Admin; No Auth | 200; `data.schedule.memoryPhotosEnabled` is Boolean true |
| 3 | `POST /memory-photos` with File `images`; anonymous `GET /memory-photos/{{photo_id}}/image` | Student; No Auth | 201 PENDING; image is 404 before approval |
| 4 | `GET /admin/memory-photos` | MEMORY_ADMIN | 200; own ID in `data.photos`, PENDING, newest first |
| 5 | `GET /admin/memory-photos/{{photo_id}}/image` | MEMORY_ADMIN | 200 image bytes; `image/png`, no-store, nosniff; not JSON or a URL |
| 6 | `PATCH /admin/memory-photos/{{photo_id}}/review` with `{"status":"APPROVED"}` | MEMORY_ADMIN | 200; `data.photo` has APPROVED, reviewedBy and reviewedAt |
| 7 | `GET /memory-photos?page=1&limit=50`; `GET /memory-photos/{{photo_id}}/image` | No Auth | 200; own photo has likeCount 0, image bytes have no-store and no ETag/Last-Modified |
| 8 | `POST /memory-photos/{{photo_id}}/like` twice; public list; `DELETE` same path twice; public list | Student mutations; No Auth lists | All 200; liked true/count 1 twice, then false/count 0 twice; lists agree |
| 9 | Upload #2, reject it; upload #3, leave it PENDING; upload #4; repeated reviews and unauthorized operations | As labeled per request | Second/third uploads 201; rejection 200; fourth upload 409 despite rejection; other expected negatives below |
| 10 | `PATCH /admin/settings` with `{"memoryPhotosEnabled":false}`; public settings/list/image, upload/likes; admin queue/image/reject #3 | As labeled per request | Settings 200 false; public feature/mutations 403; admin moderation still 200 |

Stage 9 reuses the second-photo rejection to confirm full ADMIN moderation;
MEMORY_ADMIN approves the first and rejects the third while disabled. Additional
full ADMIN checks cover private-image/global-settings reads, contestant
create/read/update/delete, and old-gallery upload/list/delete. Temporary IDs are
chained in `candidate_id` and `gallery_image_id`. MEMORY_ADMIN cannot read
or edit admin settings, manage contestants/gallery, vote, provision accounts,
upload or like. See [permission boundaries](memory-admin-roles.md).

Stage 9 additionally checks: rejected and pending image/like access 404;
unlike pending 404; repeated approved/rejected reviews 409; student admin
queue/image/review 403; anonymous private admin image/upload/like 401; admin
upload/like 403; malformed photo ID 400; nonexistent well-formed ID 404; invalid
review status PENDING 400; client-supplied userId 400; gallery limit 51 gives 400.
The fourth upload must use a valid image: file validation occurs before quota
reservation, so an invalid fourth file would return 400 rather than prove 409.

After disabling, approved public image requests with conditional headers must
return 403, not 304 or cached bytes. A valid student upload returns 403 even
though the quota is exhausted: the feature gate runs first. Admin retrieval and
rejection of the third photo still work. The normal final state is one APPROVED
photo, two REJECTED photos, zero likes on the approved photo, three lifetime
slots used, and the feature disabled.

## Response contracts

- Upload: `201 {status:"success", data:{photo:{id,status:"PENDING",createdAt}}}`.
- Admin queue: `200 {status:"success",results,data:{photos:[...]}}`; metadata
  includes owner IDs, but never private image keys. It is an unpaginated queue.
- Review: `200 {status:"success",data:{photo:{id,owner,status,createdAt,reviewedBy,reviewedAt}}}`.
- Public list: `200 {status:"success",results,pagination:{page,limit,hasMore},data:{photos:[{id,createdAt,likeCount}]}}`.
  Default limit 20, maximum 50; page is 1–1000. No arbitrary filter parameters.
- Like/unlike: `200 {status:"success",data:{photoId,liked,likeCount}}`; no request
  body/query fields. Repeating POST or DELETE is idempotent, not a 409.
- Images are byte responses with the actual image Content-Type, never JSON
  containing storage locations. Pending/rejected and absent public records all
  return 404 while enabled. Admins retrieve all statuses through their own route.
- Expected errors have `status:"fail"` and a message; development also includes
  diagnostic fields. Storage/uncertain-persistence errors can return generic 503.

## Integration risks found during source inspection

1. **Feature-disable race:** likes check Election and APPROVED state before a
   separate like write; settings and likes are not one atomic transaction. A
   request already in progress can mutate after a concurrent disable. Similarly,
   image delivery rechecks just before streaming but cannot retract bytes already
   delivered. Collection checks are sequential, not proof against these races.
   See [like controller](../controller/memoryPhotoLikesController.js),
   [public controller](../controller/publicMemoryPhotosController.js), and
   [settings controller](../controller/settingsController.js).
2. **Quota crash recovery:** durable cancellation markers fence failed inserts
   before release; known cancelled slots are recovered on the next reservation.
   Unresolved crashes can retain slots/private files. No recovery endpoint is
   implemented. Removing photo records does not
   reset accepted lifetime slots. See [submission controller](../controller/memoryPhotosController.js)
   and [quota helper](../utils/memoryPhotoQuota.js).
3. **AWS and caching configuration:** code selects a separate private bucket,
   but bucket/CDN policies and proxy overrides must be checked independently.
   S3 versioning can retain bytes behind delete markers. Do not publicly serve
   private local storage. See [storage helper](../utils/memoryPhotoStorage.js)
   and [S3 helper](../utils/s3.js).
4. **Operational limits:** pending admin listing is unbounded; uploads decode
   in memory and there is no app-level rate limiting. Public listing uses bounded
   offset pagination, which can shift under concurrent approvals. Counts reflect
   a database read and may change under concurrent likes.
5. **Account/deployment boundaries:** “student” means an active User, not a
   verified college identity. Browser CORS behavior is not proven by Postman.
   Existing election operations use a single-process queue; database-backed
   photo quotas/unique likes do not make unrelated voting/settings operations
   safe across multiple server workers. See [auth middleware](../middleware/authMiddleware.js)
   and [election helper](../utils/election.js).
6. **Local dates and indexes:** registration can close independently of Memory
   Photo, and changing the feature through existing settings may persist the
   existing candidate-management lock once voting has started. Unique like
   index initialization must succeed; old duplicate database rows can prevent
   startup. See [seed](../utils/seed.js) and [Election model](../model/electionModel.js).

## Final validation — 2026-10-19

The final three-role collection was executed with Newman against the actual app,
an isolated temporary standalone MongoDB database and local image storage. The
run created generated test-only STUDENT and ADMIN accounts directly in that new
database, then provisioned MEMORY_ADMIN through the real API. The schedule was
set to 2099 only in that disposable database so contestant management was open.
The runner imported app.js directly; server.js, dotenv and credential files were
never loaded, and no shared/production database was targeted.

| Check | Passed | Failed |
| --- | --- | --- |
| Requests | 76 | 0 |
| Assertions | 219 | 0 |

All 76 planned requests ran; there were no runner failures. Expected 400/401/403/404/409
responses count as passed checks, not failed requests. All 135 request scripts
parsed. The ten extra requests beyond the original 66 close full-admin positive
permission coverage; an existing rejection was reassigned instead of duplicated.

Final database checks confirmed feature disabled, three submissions, one
APPROVED, two REJECTED, three quota slots, zero likes, both roles recorded as
reviewers, and removal of the isolated contestant/gallery record. Source-file
hashes confirmed application code, dependencies and existing tests were unchanged.
The temporary database, accounts and image directories were removed afterwards.
The sanitized per-request report is retained locally as
`postman/Memory-Photo.integration-results.json` and excluded from commits.

No application defect was found during this integration run, so no logic was
changed. Existing documented race/recovery and deployment risks still apply.
This sequential run does not prove concurrency, Postman's graphical import/file
picker, browser CORS or live AWS integration.
