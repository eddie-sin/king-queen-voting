# Manual voting controls: regression and error audit

Date: 25 October 2026 (Asia/Rangoon). Branch: `eddie/manual-voting-controls`. Inspected commit: `6846b6e2d70b22f5dfdda88cf9c6b8f699994a39`.

**Decision: safe for continued isolated local manual testing, but NOT READY TO MERGE.** Current-contract journeys mostly work. The committed regression suite is broken by the redesign, unrelated staff can retrieve the aggregate ballot count, and Windows startup/deployment compatibility still needs work. No application fixes were made during this audit.

## Scope and safety

- Kept the current branch and commit; no switch, reset, merge, commit, push or AWS operation.
- Did not read `config.env`, AWS credentials or production configuration. Generated audit credentials remained in memory and were not included in reports, screenshots or request logs.
- Inventoried the two existing previews before testing. Did not send their accounts any vote, content, permission, feature-control or clear-votes mutations.
- Created three separate, randomly named audit databases on the already-running disposable local replica set at port 27030. Each database was verified empty before startup. All destructive controls, account changes, uploads and browser mutations targeted these audit databases only.
- Audit backend processes used the real `server.js`, development mode, local public/private image directories, generated JWT secrets, and a test-only preload suppressing dotenv and rejecting live AWS SDK sends. Authorization was exercised through real account login/provisioning APIs, not patched to make requests succeed.
- Existing storage regression tests used their existing mocked S3 operations; these are not live AWS tests.
- All three audit databases were dropped after testing, with a strict generated-name/connection guard. Audit-only backend and Vite servers were stopped. Local screenshots and redacted results were retained in an ignored artifact directory.
- All collection counts in both existing preview databases matched before and after each audit run. This is a count comparison, not a claim that every document byte remained unchanged: the older preview's existing nodemon watcher restarted on artifact changes, and startup can update its internal control fence. No manual-preview records were deleted or reset by audit requests.

## Existing preview inventory

Verified through TCP listeners, HTTP settings responses, replica-set hello, MongoDB process options and collection counts.

| Environment | Services | MongoDB/database | Processes observed |
| --- | --- | --- | --- |
| `manual-controls-preview` | Backend `http://127.0.0.1:5602`; student `http://127.0.0.1:5673`; admin `http://127.0.0.1:5674` | `127.0.0.1:27029`, replica set `kqvManualPreview`, database `kqv_manual_preview_fa866c0c70e7` | MongoDB PID 30500; student Vite PID 27904; admin Vite PID 26960; backend PID changed from 13952 to 21380 during watcher restarts |
| `manual-v2-startup` | Backend `http://127.0.0.1:5702`; no frontend belonging to this setup | `127.0.0.1:27030`, replica set `kqvManualV2Preview`, database `king_queen_manual_v2_preview_cf027c6f4aa9` | MongoDB PID 24568; backend PID 616, stable during inspection |

PIDs are observations, not safe permanent cleanup targets. Verify command lines before stopping a process. The two previews have different database paths and image directories. In particular, ports 5673/5674 proxy to 5602, not 5702.

The audit did not create another MongoDB server. Its databases were:

- `kqv_audit_844104cdec140c79`: main API/browser audit.
- `kqv_audit_5f25d66ddc4d57ce`: closure/recovery/validation checks.
- `kqv_audit_2a56aea0e6aed3a8`: actual admin controls, Lantern browser journey and accessibility checks.

These three databases were removed. Their temporary API/frontend ports were used only during the runs and are not preview URLs to reuse.

## Test results

| Check | Passed | Failed | Skipped | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Current-contract main API/browser audit | 24 | 1 | 0 | Failure is aggregate ballot-count exposure, M1 |
| Additional closure/restart/auth validation | 7 | 0 | 0 | Includes a 24-request vote/close race and persistent clear receipts |
| Actual admin-controls/Wish/accessibility audit | 4 | 1 | 0 | Failure is admin password-label association, L2 |
| Existing backend Node suite | 22 | 8 | 0 reported by Node | Seven failures are whole test files that cannot load; their child cases never execute |
| Existing frontend unit suite | 30 | 4 | 0 reported by Node | Removed API methods/exports and old contracts |
| Existing admin unit suite | 2 | 0 | 0 | Lantern utility tests only; not broad admin coverage |
| Existing non-live browser scripts | 5 | 3 | 0 | Listed below; mock/selector failures require interpretation |
| Backend JavaScript syntax checks | 61 files | 0 | — | No syntax failures |
| Student and admin production builds | 2 builds | 0 | — | Both Vite builds passed |

Current-contract totals: **35 scenarios passed, 2 failed**. The API helper recorded **335 requests**, with statuses: 200: 188; 201: 52; 400: 15; 401: 9; 403: 20; 404: 5; 409: 46. **No recorded 5xx responses.** These counts exclude additional browser-generated traffic and two raw malformed/oversize JSON probes, which correctly returned 400/413.

Expected negative responses included disabled-feature 403s, hidden image 404s, unauthenticated/wrong-kind 401s, cross-role 403s, invalid input 400s, removed API 404s, and conflict/quota 409s. They were asserted rather than treated as unexplained errors. M1 is an incorrect successful disclosure, not a 5xx failure.

The main live-browser audit recorded zero JavaScript exceptions. Its two console errors were expected during deliberately offline and disabled-feature tests: `ERR_INTERNET_DISCONNECTED` and a 403 resource response.

### Existing backend failures

The full suite was run against the test files' own temporary MongoDB instances, with real configuration and AWS blocked. The result is **22 pass / 8 fail**, not the previous main branch's 146-test result. Whole-file loader failures mean many former individual tests are not discovered.

Failing files: `test/api.test.js`, `test/memoryAdminRoles.test.js`, `test/memoryPhotoLikes.test.js`, `test/memoryPhotoModeration.test.js`, `test/memoryPhotoPublicGallery.test.js`, `test/memoryPhotoSubmissions.test.js`, and `test/rules.test.js`. They still import removed election/credential/results/schedule modules or assume their retired contracts.

The additional individual failure in `test/memoryPhotoModels.test.js` creates an Admin without a role; the new schema requires one. Five other model tests pass. All 11 private-storage tests and all six existing public-storage tests pass.

### Existing frontend/browser failures

- `frontend/tests/api.test.js`: two failures call removed `api.change` / `api.remove` operations.
- `frontend/tests/domain.test.js`: imports removed schedule/key helpers such as `scheduleState` and `validKey`.
- `frontend/tests/finalists.test.js`: imports removed `finalistsState` / `publicFinalists` helpers.
- Browser scripts passing: `memory-browser.mjs`, `memory-gallery-browser.mjs`, `memory-mine-browser.mjs`, `memory-upload-browser.mjs`, and `music-browser.mjs`.
- `memory-likes-browser.mjs` fails with a click timeout. Its anonymous-login scenario still looks for a form button named `Login` at line 132, while the current form says `Sign in`. Its mock settings/account contracts also remain legacy-shaped. The independently executed real like/refresh/unlike journey passed.
- `wish-browser.mjs` failed twice because `Read wish 5` intercepted pointer events intended for `Read wish 1`; see M3. It additionally contains a stale `Login` selector at line 34, which will need updating after the overlap is addressed.
- `frontend/tests/browser.mjs` fails and still encodes voting-key, change-vote and remove-vote flows that this branch deliberately removes. A separate Bearer-header mock failure was already reproduced against main during the earlier Phase 7 review; do not label that historical fixture assertion a newly proven application defect. The current real final-vote/browser-refresh journey passed.

The test files themselves are unchanged between `origin/main` and this branch. Most new failures therefore reflect **test-contract obsolescence caused by branch implementation changes**, rather than newly edited tests. This does not make a red regression suite acceptable for integration.

## Behavior verified against the running application

### Startup, transactions, indexes and API contracts

- Fresh empty v2 initialization succeeds on a replica set and starts with all controls closed/hidden.
- Verified unique indexes for `(round,user,contest)` ballots, one Lantern vote per user, and `(photoId,userId)` Memory likes.
- Real staff/candidate/control mutations exercised replica-set transactions with actual indexes and database-backed permission checks.
- Malformed IDs return 400. Invalid JSON returns 400; JSON above the Express limit returns 413.
- Removed `PATCH /admin/settings` and `POST /admin/memory-admins` return 404. This is an intentional breaking API change requiring Postman/tooling updates.
- Current React adapters worked for supported login, final votes, Memory history/uploads/gallery/likes and Lantern controls/votes.

### Authentication and permissions

- Higher admin startup seeding, delegated staff provisioning, student registration and all login flows succeeded with generated accounts.
- Public requests cannot access protected endpoints. Student JWTs cannot access admin routes; admin JWTs cannot act as students.
- Forged/invalid tokens and legacy tokens without version `v` are rejected.
- Creating an `admin` through delegated staff provisioning, changing a delegated account to higher admin, and assigning cross-role grants are rejected.
- Removing `votes.read` takes effect on the next private-total request. Restoring it works without a new login.
- Disabling an account invalidates its old session. Resetting a staff password invalidates the old JWT/password and permits the new login.
- MEMORY_ADMIN/LANTERN_ADMIN cannot read private candidates; unrelated roles cannot read Memory moderation; delegated roles cannot manage staff.
- Inherent role permissions remain important: Memory reading and Lantern management are role-level capabilities, even with no optional grants. Higher ADMIN has full backend permission, but its UI intentionally exposes only staff management.

### King/Queen manual voting

- Stale revisions return 409; invalid command metadata returns 400. Repeating a completed operation does not repeat its state change.
- Concurrent commands sharing a revision produced one success and one conflict.
- Twelve concurrent same-choice submissions persisted exactly one ballot for that student/category; repeated choices were idempotent. Switching candidates was rejected, while the Queen category remained independent.
- Editing candidates, clearing votes and announcing while voting is open are blocked.
- Close/reopen rejects delayed old-window votes. Results remain hidden until announcement opens. A tied title position blocks announcement; additional votes can resolve it.
- Public title counts matched actual ballots. The King title wording issue is documented in L1.
- Clearing votes required the exact confirmation, advanced the round and removed ballots only from the separate audit database. A delayed retry did not remove a newer round's vote, including after backend restart.
- A 24-request concurrent vote/close test returned only expected 200/201/409 outcomes and persisted no duplicate ballots. Post-closure new votes were rejected.
- Backend restart closed an open voting window and retained accounts/ballots. Candidate deletion with recorded ballots was rejected.
- Actual Voting Admin browser controls opened/closed voting. A real student confirmed a final vote, navigated to Account and retained the recorded choice after refresh.

### Lanterns

- Authorized local PNG upload/management worked. Lantern editing during open voting was rejected.
- Eight concurrent duplicate submissions resulted in one selection; changing that selection was rejected.
- Equal highest totals blocked announcement. Hide/reopen advanced the voting window, rejected a delayed old-window request and preserved existing votes.
- A unique winner was announced with the correct count. Lanterns with recorded votes could not be deleted.
- Actual Lantern Admin controls and student confirmation/reload/winner display worked through the browser.
- Lantern votes are permanent in this design; there is no reset/remove/switch API. This is intentional behavior, not a failed clear-votes operation.

### Memory Photo

- Disabled upload/gallery/history/like-status/likes returned 403; moderator reads remained available.
- Non-image content disguised as PNG and files above 5 MB were rejected without consuming quota.
- Real uploads returned only ID/status/timestamp. Pending/rejected images were inaccessible publicly and through `/uploads`; ordinary students could not use private moderator retrieval.
- Other students' My Memories stayed empty. The owner received authoritative quota and only safe submission fields.
- Approval/rejection were terminal, with reviewer and timestamp recorded. The moderation listing correctly returned all statuses under this branch's new contract.
- Rejected photos retained their lifetime slots. A fourth submission failed. Eight concurrent attempts from a fresh student accepted exactly three.
- Simultaneous conflicting reviews produced one 200 and one 409.
- Public approved-image bytes matched the uploaded PNG and used no-store caching. Gallery metadata omitted storage keys/reviewer details and excluded unapproved photos.
- Twelve simultaneous same-user likes remained a single like with consistent count. Batch liked states were isolated by student. Duplicate IDs, cross-user fields and hidden-photo probing were rejected or uniformly omitted. Repeated unlikes remained idempotent.
- Actual React upload/PENDING envelope/quota, approval, approved image, like-refresh-unlike, keyboard viewer, offline recovery and disabled states passed.
- Actual Memory Admin toggle and private-image approval worked in the browser.

### UI, responsiveness and accessibility basics

- Checked home, King, Lanterns, Memory gallery/history/upload, Account, Wish Sky and Developers at 1440, 1024, 768, 390 and 320 pixels. No document-level horizontal overflow or missing image `alt` attributes was detected in those checks.
- All four admin workspaces were inspected at desktop and 320px. No document-level overflow was detected. A horizontally arranged navigation/table is not a full screen-reader accessibility certification.
- Photo viewer opened with Enter, closed with Escape and restored focus. Existing Memory demo/browser coverage also exercised reduced motion.
- Offline gallery retry recovered without displaying demo content. Student/admin production builds passed.
- Wish feed total and identity-free records were verified against the real backend; the frontend rendered the current total.
- Admin password association fails the explicit accessibility probe: L2.

## Confirmed issues and reproduction

### Critical

None confirmed in the exercised paths. This is not proof that untested crash/capacity cases are safe.

### High — H1: committed regression suite cannot validate the new system

**Expected:** repository regression commands execute against the supported schema/API and provide meaningful coverage before main integration.

**Actual:** backend 22/8 and frontend 30/4; multiple files fail during import. Schedule/key/result-snapshot helpers and old role defaults no longer exist. Existing standalone test databases cannot exercise the new transaction design without replica-set fixtures.

**Reproduce:** with dependencies and a local mongod available, run `npm test` and `npm --prefix frontend test`. Do not connect these tests to a real application database. Observe missing-module errors, missing `api.change`/`api.remove` methods, and the required Admin role validation failure. Backend failures are in the files listed above; frontend failures are in `api.test.js`, `domain.test.js`, `finalists.test.js`.

**Required before merge:** deliberately update the assertions and isolated replica-set fixtures for the new contracts; retain duplicate, quota/fence recovery, permission and failure-path coverage. Do not skip tests just to make CI green. The main deployment workflow runs these commands, so this is an integration blocker.

### Medium — M1: unrelated staff can retrieve the aggregate King/Queen ballot count

**Expected:** staff without `votes.read` cannot obtain private vote totals. They may read public controls without receiving ballot counts.

**Actual:** `GET /api/v1/admin/settings` returned `ballotCount: 4` to MEMORY_ADMIN without `votes.read`, while `/admin/vote-totals` correctly returned 403. The settings and command-response serializers return counts without a separate totals permission check. Individual voter identities were not exposed by this test.

**Reproduce in a disposable database:**

1. Provision MEMORY_ADMIN with only Memory grants.
2. Open voting and record several King/Queen ballots with students, then close/hide announcement.
3. Sign in as MEMORY_ADMIN and request `/admin/settings` with its Bearer token.
4. Inspect `data.ballotCount`; compare `/admin/vote-totals`, which is denied.

**Files:** `controller/settingsController.js:12`, response construction around lines 35/92; `route/adminRoutes.js:18`. No change made. Review both GET and command response paths when fixing.

### Medium — M2: repository MongoDB launcher is not Windows compatible

**Expected:** documented local startup works on the user's Windows machine without touching shared MongoDB.

**Actual:** `scripts/localMongo.cjs:15` launches `mongod --fork`, unsupported by native Windows MongoDB. `npm run mongo:start` cannot reliably provide the required local replica set as written. The legacy Memory preview launcher is also intentionally retired.

**Reproduction:** inspect the launch arguments or run the helper in a fresh Windows test context with mongod on PATH and the helper's port free. Native mongod rejects `--fork`. This audit did not run that fixed-port helper against an unknown occupied port; it used already-verified disposable replica sets. This finding is a confirmed platform incompatibility from the launch command, not a new destructive execution.

**Files:** `scripts/localMongo.cjs`, `package.json`, README setup instructions. The ignored Windows preview launchers are a workaround, not a repository fix.

### Medium — M3: Wish lantern overlap blocks a visible pointer target

**Expected:** the visible `Read wish 1` target can be clicked under the tested layout/reduced-motion configuration.

**Actual:** the existing Wish browser test timed out twice because `Read wish 5` intercepted its pointer events. This is a pre-existing issue also documented during the earlier main-branch review; it is not newly introduced by the manual-controls redesign.

**Reproduce:** run `frontend/tests/wish-browser.mjs` with local Playwright/Edge configured, its normal mocked feed and existing viewport setup. Click `Read wish 1`. The Playwright call log reports another floating-wish button intercepting the click. Overlap may vary by timing/layout. Do not force-click to claim the UX is fixed.

**Files:** `frontend/src/wishes/WishSky.jsx`, `frontend/src/wishes/wish-sky.css`, `frontend/tests/wish-browser.mjs`. The test also has the obsolete `Login` selector after this point.

### Low — L1: King winner title wording

**Expected:** approved event wording for the male first-place title.

**Actual:** `GET /results` returns `Mrs Thadingyut` for the King winner; the focused branch script explicitly expects that string. Treat this as a product-wording issue to confirm, not a calculation error.

**Reproduce:** obtain a unique positive-vote King leader, close voting, open announcement and read `data.results.kings[0].title`.

**File:** `utils/voteTotals.js:24`. Female title is `Miss Thadingyut`; second-place titles are Prince/Princess.

### Low — L2: admin password label is not associated with its input

**Expected:** the visible Password label names the input programmatically.

**Actual:** the admin password input has no associated label, `aria-label` or `aria-labelledby`. It can be located by placeholder, but the explicit association probe fails. This structure already exists in main and is not a new branch regression.

**Reproduce:** open the admin login page without signing in; inspect the password input's `labels` collection and aria naming attributes. The visible label is rendered inside a plain Field container rather than associated with the control.

**File:** `admin/src/App.jsx`, login `Field label="Password" plain` markup. Fixing the association should not change the visual design.

### Low — L3: older local preview watcher restarts on audit artifacts

**Expected:** writing ignored test evidence should not restart a manual-testing backend.

**Actual:** `manual-controls-preview` logged nodemon restarts and changed its listening backend PID while audit artifacts were written. Its attempted nodemon config was not effective; logs report watching `*.*` and JS/CJS/JSON extensions. The branch's seed closes voting on restart, so leaving this watcher active can interrupt manual control tests. The stable `manual-v2-startup` backend PID stayed unchanged.

**Reproduction:** with the older preview running, create/edit an ignored JSON/CJS audit artifact; observe its backend log/PID. No deliberate data-reset request is needed. Existing collection counts stayed unchanged during this audit; internal startup fences can change.

**Affected setup:** ignored `frontend/test-artifacts/manual-controls-preview/launcher.cjs`, not tracked business logic. Prefer the stable backend setup, with explicitly targeted frontends, until the watcher is corrected in a separate task.

## Intentional changes and outstanding limitations

These must be understood before integration, but are not unexpected runtime failures in the tests above:

- Existing main databases and JWTs are incompatible. `utils/seed.js` intentionally rejects legacy documents/indexes; middleware rejects tokens without version `v`. No migration, data-retirement or rollback procedure has been validated. Never point this branch at the old database to bypass the guard.
- Main's deployment workflow may deploy when its flag is enabled. A compatible v2 database/configuration cutover and rollback plan must precede deployment. AWS, deployment settings, infrastructure and production readiness were not tested here.
- One API process is required by the admission queue/close design. Multi-worker operation is not certified.
- Higher ADMIN has backend access to all features but only staff management in the UI; use specialized staff accounts for the feature dashboards. This is documented behavior, not a successful full-Super-Admin dashboard implementation.
- Moderation listing is all-status and unpaginated; its size can grow beyond the former pending-only queue. Load/pagination work is a future scalability concern, not a failure reproduced with the small audit dataset.
- README contains superseded descriptions of two roles, pending-only moderation and all-candidate public totals. Actual code has four roles, all-status moderation and up to two positive-vote public title holders per category.
- The old Postman collection's settings/provisioning contracts cannot be run unchanged on this branch. Use manual command actions and `/admin/staff`, and keep generated credentials/JWTs local-only.

### Explicitly deferred/not exercised

No official Node test was marked skipped, but the following audit scopes were not executed: live AWS/S3/privacy verification; production deployment; 100-vote/30-registration capacity measurements; multi-process voting; injected unknown-commit/rollback failures; full durable cancellation-marker/process-recovery fault scenarios; crash-at-every-transaction-phase testing; full automated WCAG/color-contrast/screen-reader certification. Obsolete import failures also prevent the old cancellation/recovery regression cases from executing until fixtures are updated.

The branch-supplied `scripts/checkStaffLantern.cjs` was reviewed but not run unchanged because it hardcodes replica set `kqvLocal` on port 27018. Equivalent and broader role/Lantern checks were run against the explicitly verified audit database instead; no unrelated MongoDB service was started to satisfy that script.

## Evidence and reproduction commands

Detailed local-only artifacts: `frontend/test-artifacts/manual-controls-audit/`. This directory is ignored and contains no committed credentials. Redacted test reporters intentionally omit request/response bodies, authorization headers and raw account data.

- `results.json`, `extra-results.json`, `ui-controls-results.json`: current-contract results, status codes, findings and cleanup.
- `backend-tests.ndjson`, `frontend-tests.ndjson`, `admin-tests.ndjson`: redacted Node results.
- `browser-suites.json`: existing browser script outcomes; `syntax.json`: syntax results.
- `memory-pending-desktop.png`: real submission envelope and quota.
- `memory-gallery-320.png`, `king-320.png`: small-screen evidence.
- `admin-*-desktop.png`, `admin-*-320.png`: four role workspaces.
- `voting-controls-desktop.png`, `memory-moderation-desktop.png`, `lantern-winner-desktop.png`: actual controls/moderation/winner journeys.

The ignored audit harnesses can reproduce this audit while the verified local replica set at port 27030 is running:

```powershell
node frontend/test-artifacts/manual-controls-audit/audit.mjs
node frontend/test-artifacts/manual-controls-audit/extra.mjs
node frontend/test-artifacts/manual-controls-audit/ui-controls.mjs
```

Each creates a fresh `kqv_audit_*` database, uses generated accounts and local images, and removes only that database afterward. Do not modify its database safety checks or reuse a real database. The original preview services are not started or stopped by these harnesses.

## Before merging

1. Restore meaningful green regression coverage for v2 roles, controls, transactions, results and Memory recovery; repair obsolete browser fixtures/selectors.
2. Resolve M1's vote-count permission leak, including command responses.
3. Make supported Windows replica-set startup reproducible without the ignored workaround.
4. Confirm award wording, repair the password label and decide how to handle the pre-existing Wish pointer-overlap issue.
5. Approve the intentional breaking contracts and prepare an isolated v2 cutover/rollback/deployment plan. Run the deferred recovery/capacity checks appropriate to the event before production.

Continue manual testing only on the explicitly disposable databases with local storage. Keep live S3 verification deferred. No application code or permission bypass was introduced to make the audit pass.
