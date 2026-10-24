# Memory Photo Phase 6A: local browser integration

Verified on `codex/memory-photo-frontend-phase-1`, 22 October 2026.

The actual React development frontend ran through Vite's proxy to the actual
Express app and a newly spawned, loopback-only MongoDB instance. The database
and public/private image directories were created under a unique temporary
directory. `config.env` was not loaded. Generated administrator/student
credentials and JWTs remained in memory; no HAR, trace, request bodies or
authentication headers were saved. S3 image operations were guarded to fail
closed and were never invoked. No application logic was changed.

Final run: **10 journey checks passed, 70 explicit assertions passed, no failed
checks**. There were **77 completed API requests**: 57 from React and 20 from
setup/moderation/privacy checks. HTTP results were 62 x 200, 4 x 201, 6 x 403
and 5 x 404. The 403/404 responses were expected negative checks, not failures.
The deliberate browser-offline request has no completed HTTP response and is
not included in those totals.

| Journey | Result |
| --- | --- |
| Generated full admin, moderator provisioning/login, moderator toggle denied, full-admin enable | PASS |
| Student registration and login through the existing React account dialog | PASS |
| Real PNG upload through React; PENDING envelope; quota 3/1/2; private review image | PASS |
| Memory Admin approval; refreshed approved image in My Memories | PASS |
| Express gallery image; like, browser reload, unlike; accurate counts/state; keyboard viewer | PASS |
| Second upload rejected; rejected envelope; quota remains 3/2/1; private image | PASS |
| Gallery/history/upload layouts at 1440, 390 and 320 pixels, image alternatives | PASS |
| Browser offline failure and online retry, without demo fallback | PASS |
| Disabled gallery/history/upload/image access; logout; enabled anonymous viewing/login link | PASS |
| No JavaScript exceptions, unexpected console errors or AWS calls | PASS |

The browser used reduced motion. Accessibility checks covered image alt
attributes, form labels used during registration/login, keyboard heart/viewer
activation, Escape dismissal and focus restoration. This is not a comprehensive
screen-reader, contrast or accessibility audit.

There were four expected resource-error console messages: one deliberately
offline request and three disabled-feature 403 responses. There were no
JavaScript exceptions or unexpected console errors. No functional API contract
mismatch was found.

## Findings and limits

- **Low: cosmetic footer encoding.** The All Memories footer renders a malformed
  separator between its two phrases in `frontend/src/memory/MemoryPhotoDemo.jsx`.
  It was observed in the desktop screenshot and left unchanged for review.
- This run verifies local private storage, not S3 IAM, bucket policies, object
  delivery or deletion. Repeat the workflow against explicitly configured S3
  only after confirming prefix privacy and permissions. Existing candidate and
  gallery objects must remain outside test cleanup.
- The runner imports `app.js` and invokes the real seed helper with generated
  configuration. It intentionally bypasses `server.js`/dotenv; deployment
  environment loading is outside this test.
- Initial runner-only issues (Register-tab selector, local blob URL guard, and
  waiting for hash navigation before quota assertions) were corrected. They
  required no application fixes. Interrupted test resources were removed.

## Evidence and reproduction

Runner: `frontend/tests/memory-live-browser.mjs`. From `frontend/`:

```powershell
$env:MONGOD_BINARY = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node tests/memory-live-browser.mjs
```

The runner saves a sanitized report and five screenshots under ignored
`frontend/test-artifacts/memory-live/`. Screenshots cover desktop pending/gallery
and mobile gallery/history/upload; registration credentials and the one-time
voting key are not captured. This evidence stays local and is not staged.

Cleanup passed: feature disabled before teardown, browser/Vite/Express/MongoDB
stopped, and only the uniquely created test directory (database, accounts and
images) removed. No existing local or production database was used or changed.
No commits, pushes, merges or AWS requests were performed.
