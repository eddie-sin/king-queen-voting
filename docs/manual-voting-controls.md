# Manual voting controls — implementation handoff

Branch: `eddie/manual-voting-controls`.
Base main: `c36b854a0f31bc4a3775ab1e9a81f173bcf3ddb7`.

## Implemented application scope

- Manual registration/voting/announcement, with no date-driven changes.
- Direct user ballots; one per category/round; no credentials, vote edits or withdrawals.
- Real candidate totals with honest ties; no result snapshots or top-five selection.
- Closed/hidden conditions for candidate writes; all votes must be cleared before any candidate deletion.
- Clear-all-votes with confirmation, transaction, operation receipt and round fencing.
- `admin`/`voting_admin`, individually granted permissions, staff CRUD and token revocation.
- Higher-admin Lantern/gallery and Memory Photo toggle/moderation responsibilities.
- Student account/choice refresh and stale-response guards; memory-only admin sessions.
- Safe setup guard for legacy databases and replica-set requirement.

## Important code paths

`utils/eventControls.js` provides guarded transactions shared by votes, controls, candidate changes and staff management. It writes the controls fence so multi-document changes conflict with control transitions. Database callbacks may be retried and must not perform storage/network side effects.

`utils/voteAdmission.js` bounds active/waiting votes. Close voting rejects waiting requests immediately and allows admitted requests to finish the same window while state is `closing`. Announcement and resets require `closed`. One API process is required. Startup closes interrupted open/closing windows.

`controller/settingsController.js` validates explicit commands and their permissions. An audit operation ID makes retries idempotent; revisions prevent stale commands, especially clears, from acting on newer state. Internal control IDs are public synchronization values, not authorization credentials.

`utils/seed.js` checks for legacy documents and incompatible ballot indexes before explicit collection/index initialization. `server.js` disables connection-level automatic collection/index creation for that reason. No migration or database deletion happens on startup. The operator must select a clean isolated v2 database later; current config.env and live data were not changed during implementation.

Existing private Memory feature gates now read the central event controls. Public results exclude individual ballots and candidate private fields. Candidate uploads stay outside transactions, with permission/state rechecks and unused-upload cleanup after definite rejection. Unknown commit outcomes retain images for safe later reconciliation. The existing Queen importer now goes through guarded local API endpoints instead of direct database writes.

## Deferred at Eddie's request

The correctness/capacity testing phase has not been performed. Existing backend and browser tests still represent the old schema/API, and need deliberate updates rather than skipping assertions. Replica-set test fixtures, duplicate/retry/closure races, revoked permissions, transaction failures, restart recovery, shared-Wi-Fi registration limits, 100-vote bursts, and 30 registrations are pending.

The legacy Windows/standalone Memory preview launcher is retired; it cannot provision obsolete roles into the new system. Replace that tooling during the testing phase as needed.

Deployment and recovery preparation is also deferred: branch CI/deployment changes, updating the root-installed helper, release packaging/init dispatch, runtime readiness, a compatible code/config/database cutover, old-data retirement, and rollback rehearsal. None of the live AWS, Atlas, DNS, security-group, deployment variables or GitHub-main settings were changed.

Compilation is a useful implementation check, not proof of permission/race correctness or performance. Keep this branch out of production until the deferred review is complete.
