# Google and verified Gmail accounts

Implemented on `eddie/manual-voting-controls`. No main merge or EC2 deployment is part of this change.

## Setup and environments

Install the locked dependencies with `npm ci`. Copy the placeholder auth entries from `config.example.env` into private `config.env`. The two 32-byte hex secrets must be independently generated and retained across restarts. The sending key stays server-side and should be restricted to the verified `auth.eddiespace.com` domain. Client IDs are public identifiers; Google client secrets are not needed for this identity-token flow. Google Cloud ownership and Cloudflare/Resend ownership may use different Google accounts.

For local testing set `AUTH_ORIGIN=http://localhost:5173`. The student frontend has a fixed port and stops if it is occupied. Use **localhost**, not 127.0.0.1, in the browser because origins must match exactly. `npm run dev` selects the local replica-set database; `npm run prod` selects Atlas, but still uses the explicitly configured AUTH_ORIGIN. Start the API with either command, then `npm --prefix frontend run dev`. The local private backend port is configured separately (currently 5002 on Eddie's laptop). The API now binds to loopback unless HOST is explicitly set.

The API chooses the development Google client only when AUTH_ORIGIN is localhost/127.0.0.1; otherwise it requires HTTPS and uses the production client. For the eventual public deployment set AUTH_ORIGIN to `https://gusto-thadingyut-festival.eddiespace.com`. Never add localhost to the production Google client. Production Google is still in Testing until the owner completes branding/homepage/privacy/domain verification and publishing. All four owner-designated tester accounts were added to each Google project during setup. The Resend sending domain is verified in Tokyo. No Turnstile is used.

The private config has been prepared on Eddie's laptop only; it is ignored by Git and mode 0600. It is not automatically distributed to teammates or EC2. Teammates need their own private config, the approved development origin, and membership in the Google tester list. Do not copy private configuration into frontend variables or commit downloaded client-secret JSON files.

## Behavior and contracts

One canonical Gmail inbox key removes dots and +tags and lowercases the address. Both methods accept only @gmail.com. Google returns a verified identity, which is checked using Google's supported library, the environment's audience, a browser-bound single-use nonce and Gmail/verified-email checks. Only Google's `sub` is used as the provider identity. No inbox/Drive/Contacts scopes or Google access/refresh tokens are used.

Gmail/password signup creates only an expiring pending challenge. OTP verification creates the user in a transaction that also rechecks manual registration availability. Ordinary password sign-in subsequently needs no OTP. If an existing verified password account chooses Google for the first time, an email OTP links Google to its existing user ID. Google-only accounts have no password until a recovery/add-password OTP flow establishes one. Unverified pending passwords are never attached by Google signup. Existing disabled accounts cannot bypass restrictions through Google or recovery.

Closing registration blocks new accounts, including finalizing an already issued registration code. Existing login, linking and recovery remain available. Registration dates November 3–7 are an operating plan, not an automatic schedule. Physical gate check-in is a later feature and is not granted by authentication.

All paths below have `/api/v1/auth` prefix:

| Method / path | Input / behavior |
| --- | --- |
| GET `/config` | Returns public Google client ID and CSRF token; sets signed HttpOnly anonymous-browser cookie |
| GET `/pending` | Resumes latest unexpired OTP screen in the same browser; no automatic resend |
| POST `/register` or `/register/start` | `{email,password,operationId}` → pending verification |
| POST `/register/verify` | `{flowId,code}` → verified account and cookie session |
| POST `/login` | `{email,password}` → cookie session |
| POST `/google/start` | `{}` → random flow ID and nonce |
| POST `/google/complete` | `{flowId,credential,operationId}` → signed-in account or pending link OTP |
| POST `/google/link/verify` | `{flowId,code}` → linked account and new cookie session |
| POST `/otp/resend` | `{flowId,operationId}` → replacement OTP flow; latest admitted code supersedes old flow |
| POST `/password/recovery/start` | `{email,operationId}` → generic pending recovery response |
| POST `/password/recovery/verify` | `{flowId,code}` → five-minute reset grant, not a normal session |
| POST `/password/recovery/complete` | `{resetId,password}` → password saved, all old student sessions invalidated; sign in again |
| POST `/logout` | `{}` → deletes current server session and clears cookie |
| GET `/me` | Current user and non-secret session marker, from session cookie only |

Obtain `/config` first. All student POSTs require the exact allowed Origin plus `X-CSRF-Token`. Mutating protected student features enforce the same check, including multipart Memory uploads and wishes. Read requests use same-origin cookies. The frontend's existing `token` variable is now only a non-secret UI/session marker; it is not accepted as authentication. Session restoration uses `/me`. The old localStorage token is removed, and tab events contain no credentials. Memory pages have their own restore and server-signout handling.

Cookie names use the __Host- prefix and Secure on HTTPS, and host-only HttpOnly/SameSite=Lax in either environment. Sessions expire after five hours, with explicit expiry checks independent of TTL cleanup. Google linking and password reset revoke prior sessions. Staff routes continue to require staff bearer JWTs and ignore the student cookie. Email/provider failures never downgrade verification.

The privacy page works at `/privacy` and `#privacy`; branding can use the eventual HTTPS `/privacy` URL once it is publicly reachable. Its contact matches the Google support account chosen during setup. Update the retention statement if the organisers later choose a deletion deadline.

## Limits and mail queue

OTP codes are six digits, single use, valid for ten minutes, limited to five incorrect attempts. Digests are purpose-bound HMACs with a separate secret. Recovery grants expire after five minutes. A link resend cannot extend the original Google ownership proof beyond its original ten-minute expiry.

Durable inbox limits: 60-second resend gap, three sends/hour, five/day, plus aggregate verification attempts (20/hour). Browser send limits are ten/hour. Shared-IP limits are generous enough for 30 different simultaneous registrations; they are an additional process-local ceiling, not the sole abuse protection. Dotted/+tag aliases share limits. Without CAPTCHA, a distributed attacker can still use up a public email budget; this is an accepted availability limitation.

Daily limits are 100 total and 80 signup sends; recovery/linking can use the remaining capacity. The monthly limit is 3,000. UTC day boundaries match Resend (06:30 Myanmar time). Each admitted message reserves capacity before an encrypted short-lived mail job is committed. Counter records survive restarts and student-data reset. Reservations are conservative and are not refunded for ambiguous send outcomes. Use a dedicated Resend account/setup; outside usage and inbound email can consume the same provider quota, so monitor Resend usage as well. The split is currently a code constant, not a public admin control.

A single-process worker leases persisted jobs, sends at most one at a time, retries temporary failures up to four times with backoff, and uses stable Resend idempotency keys. No external calls run inside retryable database transactions. Confirmed sends delete their encrypted payload; expired jobs also have payload removed. Superseded/cancelled codes remain invalid even if an email was already in transit. Provider daily/monthly quota errors pause sends; restart does not clear that pause. Queue failures are reported without credentials or OTPs.

The code-entry screen checks delivery status without sending another email. Provider failures and exhausted allowances show a clear message. A repeated resend request with the same operation ID returns its replacement flow without duplicating mail, including when the first response was lost. Jobs crossing UTC midnight reserve the new day's capacity before sending; retries reuse that reservation. Month-crossing jobs also reserve capacity in the new month. If there is no room, the queued job fails visibly instead of exceeding the allowance.

At quota exhaustion, the API rejects new email admission with a truthful temporary-unavailability message. Unexpired issued codes still work. Normal password and linked Google login continue. A first-time Google link to a password account still needs its OTP. No mail is held until tomorrow with an expired code; a new request is needed. Do not bypass verification, rotate accounts to evade limits, or automatically purchase an upgrade.

If a request is interrupted after account creation, refresh the site to restore a cookie already received or sign in again. Consumed OTPs are not made reusable to handle lost responses. Resend delivery acceptance is not proof of inbox placement; real-world spam filtering remains possible.

## Explicit test reset

`scripts/resetStudentTestData.cjs` previews by default. `--cloud` chooses Atlas; `--apply` performs the allowlisted reset. It refuses any database other than king_queen_voting_v2, never drops the database, captures private snapshots and exact Memory keys under `~/.local/state/king-queen-voting/auth-cutover/`, and leaves email limits untouched. Stop old backend processes before running it. It is not a startup migration or a general admin button.

The agreed reset was performed on both the local and shared cloud v2 databases after focused checks. Cloud removal: seven student accounts, one Lantern vote, four wishes, one Memory submission and one quota record. There were no King/Queen ballots or Memory likes to remove. All seven staff accounts, all eleven candidates/images and the Lantern gallery entry were retained. Memory object cleanup completed without errors. Controls were closed/hidden and voting epochs advanced. Old accounts must register again; the owner controls when registration opens. Private recovery files remain outside Git. A subsequent isolated delivery check creates an expiring auth flow/job but no student account or vote.

## Verification and launch boundary

`npm run test:auth` runs:

- The real Google library against an isolated certificate source: signature, issuer, audience, expiry, verified Gmail, nonce presence, and development/production separation.
- Disposable local replica-set HTTP checks: OTPs, purpose/browser binding, replay, password recovery, linking/identity preservation, disabled users, registration closure, session/CSRF enforcement, quotas and queue behavior, plus 30 simultaneous registration starts on a shared IP.
- Updated focused staff/Memory/Lantern/title tests using student cookie sessions.
- A browser test against a disposable DB and fake Google transport: OTP signup, no localStorage credential, reload restoration, logout, simulated Google, Memory-page restore/logout, privacy and mobile rendering.

These scripts never load private config or deliver real email. Only the separately described real delivery check uses the supplied provider key. The production builds and dependency audit are also checked. Historical tests still targeting voting credentials, scheduled elections or student JWTs are superseded; the whole legacy suite is not claimed to pass. Full voting event capacity testing is separate.

Verified on October 26, 2026: `npm run test:auth` passed (Google-library checks, 126 student HTTP assertions plus database checks, 69 staff/Lantern HTTP assertions, and the browser flow including recovery resend). All 38 frontend unit tests and six Memory model tests passed. Both frontend production builds passed; the production backend dependency audit reported zero vulnerabilities. The legacy root `npm test` still includes seven test files importing the removed `electionModel`; these remain outside the new test command. They are not silently skipped or claimed to pass.

The one real Resend check was accepted with provider status `sent`, using one email from the shared cloud allowance. No student account or vote was created. Inbox placement still needs the owner's confirmation. A fresh local API startup connected to Atlas successfully, and the frontend proxy returned the Google config, an HttpOnly anonymous cookie, closed registration, and 401 for an unauthenticated profile. The old laptop API process was stopped before this startup.

A human must still complete actual Google sign-in with an approved tester account; automated simulation is not a claim that Google's live account chooser was tested. Real sender acceptance/inbox placement, Google branding publishing, the new domain's DNS/HTTPS, and the separate deployment review must be confirmed before opening registration publicly. This implementation does not deploy automatically or merge main.
