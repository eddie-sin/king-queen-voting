# King and Queen Voting API

Express/Mongoose backend. Candidate information and released finalist results are public. Voting requires a registered, active account, a Bearer JWT, and that account's voting key. This repository does not contain a frontend.

## Setup

1. Install dependencies with `npm ci`.
2. Copy `config.example.env` to the ignored `config.env`, then fill in your database, JWT secret, initial admin username/password, and S3 configuration.
3. Use a normal standalone MongoDB server, locally or remotely. No replica set, database transactions, or special MongoDB setup is required.
4. Start development with `npm run dev`, or production with `npm run prod`.

Use your existing local MongoDB service and a normal connection string such as `mongodb://127.0.0.1:27017/king_queen_voting`. There is no replica-set initialization step.

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

Registration body: `fullName`, `batchNumber`, `email`, `password` (at least eight characters). The key cannot be recovered; save it securely. Login returns `data.token`; send it as `Authorization: Bearer TOKEN` on protected routes.

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
