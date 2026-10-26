# Prepared authentication release — not deployed

The approved scope is code and release preparation on `eddie/manual-voting-controls`. Do not deploy, merge main, change DNS or open registration/voting until Eddie authorizes the later launch.

## Verification

`npm run test:all` runs the maintained backend suite, isolated auth/HTTPS/browser checks, both frontend suites, release-policy tests and the temporary Nginx HTTPS proxy check. Nginx and OpenSSL must be installed locally; CI provisions Nginx automatically. Install locked dependencies in root, frontend and admin first. Set `MONGOD_BINARY` if mongod is not on PATH; the test runner creates a temporary replica on a random port, never Atlas or the developer's MongoDB. Install browser engines with `cd frontend && npx playwright install --with-deps chromium webkit` (Linux CI); local Chrome is used when available and WebKit is separately installed. These tests load no private config and block real mail delivery. A new private database is dropped after each auth script and the temporary replica directory is removed. A test database is never a production migration.

The historical `test/api.test.js` now loads GitHub’s migrated v2 API coverage; `test/memoryAdminRoles.test.js` points to the new role suites. The scheduled-election and reusable-key contracts were retired. Additional local coverage is `test/manualControls.test.js`, `test/rules.test.js`, `scripts/checkStudentAuth.cjs` and `scripts/checkStaffLantern.cjs`. The four detailed Memory Photo HTTP suites have been ported to verified accounts, cookie sessions, current permissions and manual controls; their storage, cancellation, concurrency, privacy and moderation failure cases remain in the maintained suite.

## Private configuration

The prepared server file is outside Git at `/Users/eddie/.local/state/king-queen-voting/config.env.production` (0600). It uses the new production Resend key, production Google audience, canonical HTTPS origin, port 5000 and IAM-role credentials for AWS. The laptop's `config.env` and sending key are unchanged. The bootstrap password affects only a missing initial administrator; deployment does not overwrite existing staff passwords. Keep AUTH_OTP_SECRET, AUTH_MAIL_SECRET and JWT_SECRET stable across releases and preserve this file in protected storage. Never put it into the archive, an issue, CI output or chat.

`AUTH_ENVIRONMENT=production` is enforced by the prepared systemd service. A public server refuses a localhost origin, wrong client, different sender domain or wrong API bind/port. `NODE_ENV=production` by itself still allows intentional laptop testing using `AUTH_ENVIRONMENT=local`.

The existing S3 bucket/shared-prefix option is preserved in the private file; no bucket policy or object was changed. Before the later launch, verify the EC2 role can access the configured candidate and private Memory prefixes without exposing pending originals publicly. Never install the laptop's permanent AWS keys on EC2.

## Exact release

After committing the approved branch, run:

```
python3 deploy/build-release.py --output /private/output/authentication-release.tar.gz
```

This builds both sites, stamps the clean commit and packages tracked runtime sources from Git, verifying frontend file hashes against that commit. Dirty tracked files, untracked runtime files, stale assets and symlinks are refused. User reference images outside runtime roots are excluded. The archive is deterministic for identical inputs and includes RELEASE_COMMIT and RELEASE_MANIFEST.json. An adjacent `.sha256` records its checksum. Install production Node dependencies with the lockfile on the Linux target; never ship Mac node_modules or claim they are Linux binaries.

CI validates this branch and PRs with fake providers. AWS steps remain restricted to main and the existing opt-in variable. No AWS trust, variable or live workflow setting was changed. A branch push cannot deploy this release through this workflow.

## Later deployment procedure — after separate authorization

1. Snapshot the selected v2 database and protected config. Confirm a single API process and closed registration/voting/announcements for the launch checks. Do not reset students or content. The new version refuses a legacy schema before initializing it.
2. Confirm the public hostname points to the intended server using direct DNS (Cloudflare DNS-only). The application trusts only the loopback Nginx proxy; Nginx overwrites forwarded client-IP headers with the connecting address. A future Cloudflare proxy requires a separately reviewed trusted-IP configuration, never blind header trust.
3. Prepare the certificate using an HTTP ACME challenge under `/var/www/letsencrypt` and the port-80 block first. Obtain a certificate for the canonical hostname with Certbot, then install the complete `nginx-public.conf`. Test Nginx config, renewal dry-run and the renewal timer; configure a deploy hook to reload Nginx after renewal. The template has a canonical HTTP-to-HTTPS redirect, direct privacy route, no cached API responses, and Google-compatible popup headers. Keep access to port 5000 loopback-only.
4. Install the protected config as `/etc/king-queen-voting/config.env`, root:voting 0640. Install both root-owned `kqv-deploy.py` and its adjacent `release-policy.py` in `/usr/local/sbin`, and the prepared systemd service. The application user must not be able to edit these files or releases. Review these helper changes before using an older server installation.
5. Read-only preflight: run `node utils/accounts/health.js /etc/king-queen-voting/config.env` as voting from the prepared release. It checks configuration/replica/schema and prints only readiness, queue counts, conservative reserved usage and provider pause time. It sends no email, seeds nothing and does not inspect message content. Reservations include unsuccessful/cancelled requests and are intentionally not provider billing usage. Check actual Resend usage in its dashboard before any real email test; this app cannot account for other applications using the same provider account.
6. Upload and activate the exact commit/hash with the existing restricted deployment mechanism. Do not widen main-only AWS OIDC trust for this branch. The future operator can perform the reviewed manual SSM release after authorization. The updated helper verifies the manifest, preflights before stopping the old process and checks loopback readiness plus public HTTPS auth config/cookie flags and homepage/admin/privacy shells. A health check does not prove Google owner consent or inbox delivery.
7. Perform a small controlled real-account test: Google first signup/return, Gmail signup + OTP, first Google link to a password account and recovery/add-password. Confirm the same account retains votes/content. Check Gmail and Spam and provider event status. Agree the email budget first; do not run an automated real-message suite. A sending-only key cannot prove its own dashboard domain restriction; confirm the key restriction in Resend during this owner check if it is still unconfirmed.
8. Finish Google public branding/publishing once the real homepage/privacy URLs are reachable. Confirm a real account outside the configured tester list. Basic identity scopes are email/profile/openid only. Search Console ownership and provider configuration were prepared by Eddie, but final public-domain checks remain pending.
9. Open registration only when Eddie authorizes that separate manual event-control action. The intended November 3–7 period is not an automatic scheduler. Voting and physical attendance eligibility are separate decisions.

## Failure and rollback

The mail worker uses a stable idempotency key per encrypted job, a 30-second lease, an 8-second provider timeout and at most four attempts. Resend keeps idempotency keys for 24 hours; OTP jobs expire in 10 minutes. Graceful shutdown stops new mail leases and waits for the current tick before disconnecting MongoDB. Restart recovery uses the same job ID. Expired/cancelled/poisoned/permanently failed jobs lose their encrypted payloads. Reservations survive restarts and sender-key changes.

A public readiness failure leaves the service closed or restores only a previous manifest with the same database/authentication compatibility and unchanged protected-config fingerprint. An old JWT/key/scheduled-election release is never automatically started against cookie-auth data. A failed rollback is stopped. Code rollback does not revert data, controls or provider deliveries. The isolated rehearsal exercises the real activation/recovery policy on temporary directories, including compatible restore, changed config, missing/legacy manifest and unhealthy restore. Live systemd/Nginx/AWS activation is deferred.

Password-attempt limits are durable per canonical inbox (20 per 15-minute window, reset after successful login); browser/IP soft limits remain process-local to bound bursts. Email/OTP/recipient quotas are durable. Campus Wi-Fi is not treated as one account, and simultaneous signup, login and recovery requests are measured with fake mail. These checks establish the tested authentication behaviour, not whole-event capacity certification.

## Provider references

[Google sign-in setup and popup headers](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
