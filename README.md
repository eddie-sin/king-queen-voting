# King and Queen Voting API

Express/Mongoose backend. Candidate information and released finalist results are public. Voting requires a registered, active account, a Bearer JWT, and that account's voting key. This repository does not contain a frontend.

## Setup

1. Install dependencies with `npm ci`.
2. Copy `config.example.env` to the ignored `config.env`, then fill in your database, JWT secret, initial admin username/password, and S3 configuration.
3. Use a normal standalone MongoDB server, locally or remotely. No replica set, database transactions, or special MongoDB setup is required.
4. Start development with `npm run dev`, or production with `npm run prod`.

Use your existing local MongoDB service and a normal connection string such as `mongodb://127.0.0.1:27017/king_queen_voting`. There is no replica-set initialization step.

### Development and production services

| Command | Database | Image storage |
| --- | --- | --- |
| `npm run dev` | `DATABASE_LOCAL` (your local MongoDB) | Files in the ignored `uploads/` directory |
| `npm run prod` | `DATABASE` (your Atlas connection) | Your configured S3 bucket |

Production replaces `<db_password>` in `DATABASE` with the URL-encoded `DATABASE_PASSWORD`. Include the database name in the Atlas URI, for example `/king_queen_voting`, so records are stored in the intended database. Neither database credentials nor AWS credentials belong in Git.

Development image URLs start with `/uploads/` and the API serves these files publicly without login. If the frontend and API have different origins, resolve these paths against the API origin. Local uploads are never served by the production API. `LOCAL_UPLOAD_DIR` can optionally override the directory used for development files.

Production uses `AWS_REGION`, `AWS_S3_BUCKET`, and the AWS SDK credential configuration (including `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` from `config.env`). Uploads return S3 public image URLs, or URLs under `AWS_S3_PUBLIC_URL` when you configure a CDN. The bucket/CDN must permit public image viewing. Production does not fall back to local files when S3 configuration is missing.

On startup, the app builds required unique indexes and seeds the schedule and first admin automatically. `ADMIN_USERNAME` and an `ADMIN_PASSWORD` of at least eight characters are required when no admin exists. Passwords are bcrypt hashes. Subsequent startups preserve the admin password, edited dates, candidate lock, and saved finalists; changing environment variables does not reset an existing admin.

Old development credentials using `hash(votingKey)` cannot be safely attached to accounts. Use fresh development accounts/data for this version; legacy keys are rejected and never claimed on a first-use basis. Normal startup never deletes data.

## Seeded schedule

Every date below is Myanmar time (`Asia/Yangon`, UTC+06:30).

| Setting | Default |
| --- | --- |
| Account registration closes | November 6, 2026, 11:59 PM |
| Voting opens | October 28, 2026, 9:00 AM |
| Voting closes | November 2, 2026, 11:59 PM |
| Top 5 results appear | November 3, 2026, 9:00 AM |

Closing deadlines include the full stated minute, through `23:59:59.999`. Voting opens and results appear at their exact configured times. Registration is independent and intentionally remains available after voting closes. Existing accounts can still log in after registration closes.

## Public endpoints

All routes start with `/api/v1`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/candidates` | Active candidates only; no contact numbers |
| GET | `/candidates/:id` | One active candidate; no contact number |
| GET | `/images?section=memory` | Gallery images; optional section filter |
| GET | `/settings` | Myanmar date/time values, fixed labels/timezone, candidate lock status |
| GET | `/results` | Saved top 5 kings and queens, only after the release time |
| POST | `/auth/register` | Register and receive a voting key exactly once |
| POST | `/auth/login` | Log in using email and password |
| POST | `/auth/admin/login` | Log in using admin username and password |

Registration and user login require only `email` and `password`. Registration requires a valid email and a password of at least eight characters; no name or batch number is collected. The voting key cannot be recovered; save it securely. Login returns `data.token`; send it as `Authorization: Bearer TOKEN` on protected routes.

## Voter endpoints

These endpoints require a **user** JWT. `/auth/me` works outside the voting period and needs no voting key; it returns profile information and `hasVotedKing` / `hasVotedQueen`, never the chosen candidates.

| Method | Path | Body | Behavior |
| --- | --- | --- | --- |
| GET | `/auth/me` | None | Profile and participation flags |
| POST | `/voting/submit` | `votingKey`, `candidateId`, `contest` | Submit the first vote for a contest |
| PATCH | `/voting/change` | `votingKey`, `candidateId`, `contest` | Change an existing vote |
| POST | `/voting/my-votes` | `votingKey` | View chosen candidates |
| DELETE | `/voting/remove` | `votingKey`, `contest` | Remove an existing vote |

`contest` is `king` or `queen`. All four key-protected operations are available only during the voting period, including viewing chosen candidates. Keys are sent in JSON bodies rather than URLs. Each account may hold one vote per contest; after removal it may vote again. Inactive candidates and category mismatches are rejected. Disabled/deleted accounts cannot reuse an existing JWT.

Credentials store SHA-256 of `accountId + ":" + votingKey`, using the account ID from the verified JWT. Another account cannot use the same key. No account ID is stored in credentials or ballots, and chosen candidate IDs are not stored on users. This avoids a direct database account-to-choice link; it does not provide anonymity against the running server, request logging, database write-log inspection, or inference from participation flags. Do not log request bodies containing voting keys.

## Admin endpoints

These require an **admin** JWT; normal user tokens cannot access them.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/admin/candidates` | All candidates, including inactive candidates and contact numbers |
| GET | `/admin/candidates/:id` | Complete candidate information |
| POST | `/candidates` | Create a candidate |
| PATCH | `/candidates/:id` | Edit candidate information, including `isActive` |
| DELETE | `/candidates/:id` | Delete a candidate |
| GET | `/admin/settings` | Current schedule |
| PATCH | `/admin/settings` | Edit date/time values only |
| POST | `/images` | Upload gallery images |
| DELETE | `/images/:id` | Remove a gallery record |

Candidate fields are `fullName`, `batchNumber`, `nickname`, `images` (one to three URLs or uploaded files), `bio`, `age`, `zodiacSign`, `hobbiesAndInterests`, `contactNumber`, `category`, and `isActive`. `isActive` defaults to true and is optional on creation. Multipart uploads use the field `images`; JSON image URLs also work. Admin responses may include private contact numbers; public responses never do.

All candidate creation, editing, activation/deactivation, and deletion are **permanently blocked once voting starts**. Moving the voting start into the future cannot unlock them. Requests recheck this rule after uploads, immediately before the database write. Admin reads and gallery management remain available.

Schedule updates accept only `registrationClosesAt`, `votingOpensAt`, `votingClosesAt`, and `resultsPublishedAt`. Supply ISO strings with the fixed `+06:30` offset:

```json
{
  "registrationClosesAt": "2026-11-06T23:59+06:30",
  "votingOpensAt": "2026-10-28T09:00+06:30",
  "votingClosesAt": "2026-11-02T23:59+06:30",
  "resultsPublishedAt": "2026-11-03T09:00+06:30"
}
```

Unknown fields, changed labels/timezones, impossible dates, closing before opening, and publishing before voting closes are rejected. The registration deadline has no ordering constraint relative to the voting period. Date input at minute precision includes that entire minute for closing fields; explicit seconds/milliseconds are respected exactly.

## Finalists and ties

After voting closes, background maintenance finalizes results within approximately 15 seconds while the server is running. Startup catches up after downtime; the public results endpoint also finalizes on demand after release. There are no public results before the configured release time.

Active candidates are ranked by votes, separately for kings and queens. If a tied group crosses the fifth-place cutoff, an unbiased cryptographic shuffle selects the remaining finalists, including ties involving more than two candidates. The selected entries carry `selectedByTieBreak: true`. The final selection is saved once and reused across concurrent requests and server restarts.

Zero-vote active candidates remain eligible, including for a cutoff tie. If fewer than five active candidates exist in a contest, all are returned. Once finalists are saved, voting start/end cannot change or reopen voting; the registration deadline and result release time can still be edited. This prevents a saved selection from becoming stale.

## Standalone database consistency

Run one API process per election database (the default `npm run dev` or `npm run prod` setup). The process handles election operations in order so overlapping requests cannot race with schedule edits, candidate locking, or finalization. Do not use multiple workers/cluster mode against the same election database with this implementation.

Unique database indexes still enforce one ballot per credential/contest and one saved finalist result. When a request fails or crosses its deadline, the application attempts to undo its partial writes. These compensating writes are not database transactions: a process/power failure or an unavailable database during cleanup can leave partial state. A later successful key-protected request reconciles that account's participation flags with its ballots. Account flags alone cannot be repaired globally without keys while preserving the absence of account-to-ballot links.

## Verification

Run `npm test`. Node's built-in test runner starts an isolated temporary **standalone MongoDB** server and HTTP server, then removes the test database. A local `mongod` executable must be available; set `MONGOD_BINARY` if it is elsewhere. The tests never connect to the databases configured in `config.env`.

Tests cover public/private access, seeding, password hashing, key ownership, anonymous storage, vote changes/removal, exact deadlines, disabled accounts, rollback, concurrent requests, the irreversible candidate lock, immutable settings, and saved tie-break results.

## React voting page

The local React frontend lives in [`frontend/`](frontend/README.md). It uses the supplied React design from `thadingyut-react-source-matched.zip` and the existing public/auth/voting APIs. See its README for startup commands, test data preparation, and a manual voting checklist. No deployment or push is performed by the frontend scripts.


# Separate Thadingyut admin frontend

This add-on folder `admin-frontend/` is a standalone React + Vite administration application. **Do not replace the existing `frontend/`**; the public voter site stays unchanged. Place `admin-frontend/` beside `frontend/` and `app.js` at the root of `king-queen-voting`.

## Setup

1. Run the existing backend as usual from the repo root (`npm ci`, configure ignored `config.env`, start MongoDB, `npm run dev`). Initial admin credentials are created by your existing backend using the `ADMIN_USERNAME` and `ADMIN_PASSWORD` config on first startup. Do not put those credentials in frontend code.
2. Open a new terminal, run `cd admin-frontend && npm install && npm run dev`.
3. Open the Vite URL (normally `http://127.0.0.1:5174`) and sign in using **admin username** and **admin password**. This app has no public registration and uses no voter login.
4. Run `npm run build` in `admin-frontend/` to produce `dist/` for deployment.

The development Vite proxy forwards `/api` and `/uploads` to the backend, using `PORT` from `../config.env` (default 5000) or `VOTING_API_TARGET`. The admin app stores the admin JWT **in React state only**, not localStorage/sessionStorage. Refreshing the page logs you out.

## Production deployment

Serve `admin-frontend/dist/` at an admin-only hostname, e.g. `admin.example.com`, and the existing voter frontend at the public hostname. **Do not put an admin link on the public site.** Both sites may share the same Express API via a reverse proxy:

- `https://admin.example.com/api/v1/...` → `https://api.example.com/api/v1/...`
- `https://admin.example.com/uploads/...` → API `/uploads/...` (development only; production uses S3 URLs)

Alternatively set `VITE_API_BASE_URL=https://api.example.com` at **build time**, then explicitly configure an allowlisted CORS policy on the Express server (the current backend does **not** include CORS middleware). The easiest safe deployment is a same-origin `/api` reverse proxy to avoid CORS. Do not enable permissive credentialed CORS.

For a private login *page* (not just protected API) configure a hosting access policy such as Cloudflare Access with your team members' identities. `noindex` is only a crawler directive, **not security**. The existing backend admin-JWT authorization is still required.

Use HTTPS, and avoid caching authenticated API responses. Do not deploy the dev server itself.

## Supported features

- Admin sign-in through `POST /api/v1/auth/admin/login`.
- Candidate list through `GET /api/v1/admin/candidates` (includes inactive candidates and their admin-only contact numbers).
- Add via `POST /api/v1/candidates`; edit/activate/deactivate via `PATCH /api/v1/candidates/:id`; delete via `DELETE /api/v1/candidates/:id`.
- Search and King/Queen filters, details/preview, confirmation dialogs, status messages, schedule lock via `GET /api/v1/admin/settings`.
- JSON image URL editing **or** 1–3 JPG/PNG/WebP uploads, max 5 MB each. Uploading new images **replaces the entire photo array** according to the current backend controller. Images require at least one photo.
- The backend permanently locks all candidate mutations after voting begins. This app disables those controls but cannot bypass the server-side lock. Schedule is shown read-only; no schedule editing is provided.

### Current backend API contract caveat

The controller handles multipart photo uploads with field name `images`. For the optional `hobbiesAndInterests` array the admin app submits repeated fields when present; Multer produces strings/arrays accordingly and Mongoose casts a string to an array. No backend changes are needed for the tested JSON path. If you need to mix **existing photo URLs with uploaded files in one save**, extend the backend contract first; the current controller does not support that combination.

### Production privacy and access

The admin application is deliberately separate and does not expose the admin login through the voter app. Admin credentials are never embedded in source. Never commit `config.env`, `uploads/`, or other sensitive candidate records. The backend remains the security authority; an access gate at the admin subdomain can additionally restrict visibility of the login page.
