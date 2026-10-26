# Manual voting controls — completed fixes and review handoff

Branch: `eddie/manual-voting-controls`

This document records the follow-up work completed after
`docs/manual-voting-controls-audit.md`. It contains no credentials, account
passwords or production tokens.

## Audit findings resolved

- **H1 — obsolete regression coverage:** authentication, delegated roles,
  manual King/Queen controls, Lantern voting, Memory Photo, student UI and all
  four admin workspaces now have executable v2 tests using disposable MongoDB
  replica sets and private local storage. Historical wrapper filenames remain
  only as concise compatibility pointers; the large disabled v1 bodies were
  removed.
- **M1 — private ballot-count disclosure:** `ballotCount` and command receipt
  totals are returned only to ADMIN or staff currently granted `votes.read`.
  Specialized staff retain their legitimate public-control and feature
  permissions without receiving a fabricated zero or an omitted-value UI bug.
- **M2 — Windows MongoDB launcher:** `scripts/localMongo.cjs` supports native
  Windows without `--fork`, custom binary/port/path/replica-set configuration,
  ownership validation, existing-instance detection and explicit start,
  status, restart and stop commands. It refuses unknown occupied ports and
  never deletes a database or data directory. Linux/macOS retain `--fork`.
- **M3 — Wish Sky pointer interception:** pointer hit testing is limited to the
  visible lantern artwork rather than the larger transparent animated button
  box. The original animation, music and responsive presentation are retained.
  Browser coverage uses normal pointer input and verifies keyboard/focus
  behavior.
- **L2 — admin password accessible name:** the admin sign-in password input now
  has an explicit accessible name. The real admin browser test uses that name,
  rather than relying on its placeholder.

## Product wording decision

The King first-place title remains **Mrs Thadingyut**. The existing product
handoff (`docs/imported-pages-and-vote-snapshots.md`) explicitly says this was
the requested spelling, and executable result tests enforce it. Change it to
**Mr Thadingyut** only after the product owner confirms that the earlier
requirement was a typo; update the handoff, calculation tests and browser copy
together.

## Additional completed work

- Four server-owned roles are enforced: ADMIN, VOTING_ADMIN, LANTERN_ADMIN and
  MEMORY_ADMIN. Optional grants remain role-scoped and are re-read from MongoDB
  for each protected action.
- Manual registration, voting, result announcement, Lantern controls and
  Memory enable/disable use revision fencing and idempotent operation IDs.
- Memory Photo quota cancellation markers remain private and recoverable;
  rejected photos continue to consume the three lifetime slots.
- Wish Sky's live browser launcher now uses the shared disposable v2 replica-set
  fixture and supports `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
- Student and Memory browser fixtures use the current JWT, EventControls and
  final-vote contracts.
- Aggregate counts omitted by permission are rendered as unavailable, never as
  zero or `undefined`.

## Verification completed

- Backend: **123 passed, 0 failed, 0 skipped** (`npm test`).
- Student frontend: **43 passed, 0 failed**; production build passed.
- Admin frontend: **2 passed, 0 failed**; production build passed.
- Student v2 voting browser: passed registration, final King/Queen voting,
  duplicate/stale/closed behavior, 320px and keyboard checks.
- Memory live browser: **10 steps, 116 assertions, 94 requests**, with 11
  expected negative responses; all disposable resources removed.
- Memory likes browser: passed authentication, batch state, pagination,
  mutations, stale-response, account-switch and reduced-motion checks.
- Wish Sky browser: passed twice across desktop, tablet, mobile, 320px and
  reduced motion. The real browser/API/replica-set flow also passed.
- Admin workspace browser: **7 steps, 91 assertions** across all four roles,
  permission changes, moderation, totals, session expiry/revocation, keyboard
  and responsive checks.
- Native Windows MongoDB lifecycle: start, repeat start, status, restart and
  verified stop passed; occupied-port and missing-binary failures were safe;
  the test data directory remained present.

All integration tests used generated accounts, disposable local replica sets
and private local storage. No AWS objects or production records were changed.

## Eddie review notes and known limitations

- Higher ADMIN intentionally sees staff management in the current UI while
  retaining full backend authority. Specialized workspaces expose feature
  dashboards. A combined super-admin dashboard is not implemented.
- The configured Atlas `king_queen_voting_v2` database is schema-v2 compatible
  but already contains accounts/candidates and has unknown live ownership. Do
  not run destructive tests against it without explicit confirmation.
- Production startup creates/validates indexes and closes interrupted open
  King/Queen or Lantern voting windows; it is not a read-only connectivity
  probe.
- Shared-bucket Memory Photo storage is explicitly enabled in the local private
  configuration. The application identity cannot read the current bucket
  policy, ownership or Block Public Access settings, so live S3 privacy remains
  operationally unverified. Do not infer safety from `AccessDenied` alone.
- Browser automation ran with installed Chromium/Chrome. Firefox, WebKit and
  physical-device testing remain outside this pass.
- Linux/macOS MongoDB arguments are unit-tested; the real lifecycle test ran on
  native Windows MongoDB 8.3.
- The old wrapper filenames are retained so existing commands continue to work,
  but contain no retired v1 implementation. Their comments identify the active
  v2 replacement suites.
