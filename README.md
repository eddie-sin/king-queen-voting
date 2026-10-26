# King and Queen Voting

The latest [Google/Gmail authentication guide](docs/google-gmail-authentication.md) supersedes the student registration/session setup and contracts below. Student sessions now use HttpOnly cookies; old student bearer tokens are rejected. Staff bearer sessions remain separate.

Current role/workspace and Lantern extensions are documented in [role workspaces and Lantern voting](docs/role-workspaces-and-lantern-voting.md). That document supersedes the earlier two-role descriptions below. The latest [imported pages, title awards and manual vote totals](docs/imported-pages-and-vote-snapshots.md) document supersedes the earlier all-candidate public results description and adds the optional vote-total permissions.

Express/Mongoose API with React student and admin websites. This branch replaces the scheduled/key-based voting system with manual event controls.

**Authentication release preparation:** changes remain on `eddie/manual-voting-controls`. See [the launch runbook](deploy/LAUNCH.md) for isolated tests, production configuration, exact-commit packaging and rollback rehearsal. Public deployment, real-domain provider checks and whole-event capacity certification remain separate. This branch is not deployed automatically.

## Setup for this version

1. Install the existing locked dependencies with `npm ci`, `npm --prefix frontend ci`, and `npm --prefix admin ci` if needed.
2. Copy `config.example.env` to ignored `config.env` for a **separate local setup**, supplying a random JWT secret of at least 32 bytes, initial admin username/password, image-storage settings, Google client IDs, Resend sender/key, exact AUTH_ORIGIN, and two separate 32-byte hex authentication secrets. Never commit real configuration.
3. Select a **separate, empty v2 database on a MongoDB replica set**. A compatible Atlas database can also support the required transactions. A standalone MongoDB server is no longer supported. Do not reuse the current live or legacy test database.
4. Start the API with `npm run dev` (uses `DATABASE_LOCAL`, local public candidate/gallery images), or `npm run prod` (uses `DATABASE`, configured S3 storage).
5. Start the student website with `npm --prefix frontend run dev` and the admin website with `npm --prefix admin run dev`.

A local connection example is `mongodb://127.0.0.1:27018/king_queen_voting_v2?replicaSet=kqvLocal`, **after** running `npm run mongo:start`. `DATABASE` must name the isolated target database explicitly. `<db_password>` is substituted from `DATABASE_PASSWORD` as before. The application refuses detected legacy voting data instead of migrating or deleting it. Startup disables automatic collection/index creation until that guard has run, then explicitly builds the required indexes.

No local or Atlas database is reset by installing or building this branch. The local private `config.env` now points development and production to separate v2 databases; a private backup of the previous settings is kept outside Git. The isolated local database can be started with `npm run mongo:start`. It uses port 27018 and replica set `kqvLocal`, with data under `~/.local/share/king-queen-voting-v2`, leaving the shared MongoDB service alone. Run this command again after restarting your Mac. The revised automated preview/test harness remains follow-up work. The old `scripts/memoryPhotoPreview.cjs` launcher is retired and exits with an explanatory message.

Production should use EC2's existing IAM role for AWS access. Do not place database credentials, JWT secrets, passwords, or permanent AWS keys in CI, frontend variables, logs, or release archives. Memory originals retain their private storage and authenticated moderation flow.

## Accounts and initial state

Students use Continue with Google, or register a Gmail address and website password and verify an email code while registration is open. One canonical Gmail inbox, including dotted/+tag aliases, has one account. Google-only accounts have no website password until they add one through email recovery. First-time linking to an existing password account requires an OTP and preserves its user ID. Existing accounts may sign in after registration closes. See the authentication guide above for recovery, session and email-quota behavior.

The first higher `admin` is seeded from `ADMIN_USERNAME` and `ADMIN_PASSWORD`. Passwords require at least eight characters and at most 72 UTF-8 bytes. Staff usernames use letters, digits, dots, underscores and hyphens, are normalized to lowercase, and must be unique. Later startups preserve existing passwords and permissions.

Initial registration and voting are closed, announcement is hidden, and Memory Photo is disabled. There are no date-based transitions. An unexpected restart closes an interrupted open/closing voting window; staff must deliberately reopen it. The current design runs **one API process**.

The two staff roles are:

- `admin`: manages voting administrators, all controls, candidate operations, Lantern/gallery management, and Memory Photo toggles/moderation.
- `voting_admin`: always reads candidates; other voting/candidate actions require individually granted permissions. It never manages staff, Lanterns or Memory Photo moderation.

Permissions are `candidates.create`, `candidates.update`, `candidates.delete`, `voting.open`, `voting.close`, `votes.clear`, `announcement.open`, `announcement.close`, `registration.open`, and `registration.close`. New voting administrators receive none unless explicitly granted. The server reloads the account/permissions on each request and again inside guarded critical mutations. Password changes, username changes, disabling or deleting an account revoke old sessions. Permission changes apply to subsequent actions without requiring a new login.

## Event rules

| Action | Rule |
| --- | --- |
| Registration open/close | Independent control; existing accounts can still sign in after closure |
| Voting open | Voting fully closed and announcement hidden; preserves existing votes |
| Voting close | Stops new admissions, rejects waiting work, drains admitted operations, then becomes closed |
| Announcement open | Voting fully closed |
| Announcement close | Hides public totals without removing votes |
| Candidate read | Always available under the existing public/staff read boundaries |
| Candidate create/update | Voting closed and announcement hidden |
| Candidate delete | Same conditions, plus **no ballots anywhere**; clear all votes first |
| Candidate category change | A candidate with ballots cannot move between King and Queen until votes are cleared |
| Clear all votes | Voting closed, announcement hidden, permitted operator, explicit confirmation |

Each account may submit one King and one Queen ballot per round. Ballots link user → candidate directly and have a unique `(round, user, contest)` database index. No change-vote or remove-vote operation exists. Participation flags are calculated from ballots rather than stored separately on users. Clearing all votes deletes both categories' ballots and advances an internal round; accounts and all other content remain.

The internal round/window/revision fields prevent delayed requests from crossing reset/reopen boundaries. They are not voting credentials. Short transactions write a shared controls fence as well as the ballot or mutation. A bounded, single-process admission queue allows closure to finish admitted votes while preventing waiting work from starting afterward. The queue and password-worker limits still need the deferred concurrency/capacity measurements.

Results are calculated from actual ballots whenever announcement is open. All candidates and actual counts are shown, including zero counts and already-counted inactive candidates. Equal counts are ties; no random winner selection or frozen result document exists. Inactive candidates are unavailable for new votes but their recorded votes remain visible in announced totals. There is no public endpoint for individual voters' choices.

## API contracts

All paths below start with `/api/v1`. Student requests use same-origin HttpOnly cookies; student mutations also require the CSRF token from `/auth/config` and the exact allowed Origin. Staff requests use `Authorization: Bearer TOKEN` with an account kind and token version; permissions come from the database. Legacy student tokens are rejected. No credentials belong in URLs.

### Students and public reads

| Method | Path | Body / response |
| --- | --- | --- |
| POST | `/auth/register` | `{email,password,operationId}` → pending OTP; `/auth/register/verify` creates the account/session |
| POST | `/auth/login` | `{email,password}` → HttpOnly session cookie, `data.sessionKey` (UI marker), `data.user` |
| GET | `/auth/me` | Profile and ballot-derived participation flags/round |
| GET | `/settings` | `data.controls` with registration/voting/announcement/Memory flags, round, window and revision |
| GET | `/candidates`, `/candidates/:id` | Active public profiles; excludes contact numbers |
| POST | `/voting/submit` | `{candidateId,contest,round,window}`; identifiers come from the latest settings response |
| GET | `/voting/my-votes` | Own votes plus round/window, available even while voting is closed |
| GET | `/results` | Actual `data.results.kings`/`queens`, entries `{candidate,votes}`, plus round/revision; 403 while announcement is hidden |

A repeated vote for the same candidate in an open window returns its existing successful outcome; a different candidate in the same category is rejected. If a response is interrupted, refresh `my-votes` before retrying. A timeout does not prove that a vote failed. Students' browsers refresh status periodically and on focus; the server enforces every control independently of the UI.

### Staff

| Method | Path | Access / behavior |
| --- | --- | --- |
| POST | `/auth/admin/login` | `{username,password}` → token and current role/permissions |
| GET | `/auth/admin/me` | Current staff identity and effective permissions |
| GET | `/admin/settings` | Controls and total ballot count |
| POST | `/admin/controls/:action` | Explicit manual command; relevant permission required |
| GET | `/admin/candidates`, `/admin/candidates/:id` | Staff candidate reads, including private contact fields |
| POST / PATCH / DELETE | `/candidates`, `/candidates/:id` | Relevant permission and event rules required |
| GET / POST | `/admin/voting-admins` | Higher admin lists/creates voting administrators |
| PATCH / DELETE | `/admin/voting-admins/:id` | Higher admin updates/deletes only voting-admin accounts |
| GET | `/admin/memory-photos` | Higher admin lists pending submissions |
| GET | `/admin/memory-photos/:id/image` | Higher admin authenticated private image |
| PATCH | `/admin/memory-photos/:id/review` | Higher admin: `{status:"APPROVED"}` or `REJECTED` |
| POST / PATCH / DELETE | `/images`, `/images/:id` | Higher-admin Lantern/gallery management |

Control action names are the registration/voting/announcement open/close permissions, `votes.clear`, plus higher-admin-only `memory.open` and `memory.close`. Body: `{revision, operationId}`, with a fresh UUID v4 operation ID. Clear also requires `{confirmation:"CLEAR ALL VOTES"}`. Keep the same operation ID when retrying an uncertain response. A previously completed command returns current controls without repeating the action. A stale revision is rejected. This prevents a delayed clear retry from deleting a later round.

Voting-admin creation accepts `{username,password,permissions?,status?}`. Updates accept only those fields; omit password to keep it. Clients cannot select/promote a role or target a higher-admin account through these routes. All permission defaults are off. Staff actions are audited without recording passwords or individual vote choices.

The admin website keeps its token in memory; refresh requires signing in again. Its Event controls tab replaces Schedule. Higher-admin-only tabs provide voting-admin management, Memory Photo moderation and Lanterns. The server enforces these restrictions even if someone calls the API directly.

## Existing content features

Candidate photo upload/reorder behavior remains: one to three images, multipart `images`, and a JSON `data` field for candidate values; edits use `photoLayout` to preserve/reorder existing images and add uploads. Permission and control checks run before uploads and again in the transaction. Confirmed rejected uploads are cleaned up without deleting still-referenced photos. Uploads are retained when a commit outcome is uncertain, avoiding deletion of a possibly committed image. New candidates cannot reuse another candidate’s managed image URL. The optional Queen import command now calls these guarded local API routes instead of writing directly to MongoDB.

Wish Sky, music, Lantern browsing, student Memory Photo upload/history/gallery/likes, private ownership rules, review transitions and upload quotas retain their existing purposes. The higher `admin` now owns all Memory duties. Historical feature documentation remains under `docs/`, but its old role/key/schedule references are superseded by this README and [the implementation handoff](docs/manual-voting-controls.md).

## Checks and next phase

Run `npm run test:auth` for isolated Google verification, student-account/session/mail checks, focused staff/Memory/Lantern/title checks and browser auth coverage. Run `npm --prefix frontend test` for frontend adapter/domain tests. Production builds of both websites and the backend dependency audit are checked as well. The legacy root `npm test` still includes retired election-model tests; see the authentication guide for exact results and limits.

Thirty concurrent registration starts are covered. A separate event-capacity pass must still cover 100 simultaneous votes, voting crash recovery and the remaining old backend test contracts. Deployment-helper changes, compatible configuration/database cutover, and rollback rehearsal also remain separate. Do not merge/deploy this branch based on compilation alone. The existing main-only deployment workflow has not been changed in this implementation phase.
