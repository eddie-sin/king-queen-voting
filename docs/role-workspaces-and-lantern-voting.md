# Role workspaces and Lantern voting

The higher `admin` workspace now shows staff-account management only. Existing backend admin privileges remain available, as requested. To operate voting or other features through the UI, create a separate staff account.

## Roles

- `voting_admin`: candidates and King/Queen event controls, governed by existing per-action permissions.
- `memory_admin`: can always read current uploaded photos of all moderation statuses and their private images. Separate grants are `memory.open`, `memory.close`, `memory.approve`, `memory.reject`. Review decisions remain terminal: only pending photos can be accepted/rejected.
- `lantern_admin`: Lantern CRUD is part of the role. Separate grants are `lantern.open`, `lantern.close`, `lantern.announce`, `lantern.hide`.

The higher admin creates, edits, disables, resets passwords for, and deletes all three staff types through `/api/v1/admin/staff`. Roles cannot be changed during editing. Higher-admin accounts cannot be created or modified through this endpoint. Permissions are restricted to the selected role. Entertainment administration is deferred.

## Lantern voting

- `GET /api/v1/lantern-voting`: public open/announcement state, window and announced winner.
- `GET /api/v1/lantern-voting/mine`: authenticated account's recorded selection.
- `POST /api/v1/lantern-voting`: `{lanternId, window}` with a user Bearer token.

One permanent vote per account, enforced by a unique user index. No change/remove/reset endpoint exists. Repeated submission of the same choice is idempotent; a different choice is rejected. A reopening changes the window so delayed old requests cannot submit. Existing votes are preserved.

Close voting before announcing. Announcement requires at least one vote and exactly one highest-voted lantern. A tie blocks announcement; reopening for additional votes is possible after hiding announcement. All Lantern mutations and vote/control changes share the transaction fence. Lantern CRUD is blocked while voting or announcement is open. A Lantern with recorded votes cannot be deleted. Uploaded objects are cleaned up after definite rejection or deletion; uncertain commits retain their objects.

Memory review permissions are rechecked in a transaction. Staff permission changes and account revocation apply through existing live database checks. Public Lantern responses never contain individual voters' identities.

## Interface updates

All password-entry forms use a Show password checkbox, including admin sign-in, staff creation/reset and student sign-in/registration. Wish Sky shows the total stored wish count, refreshes it periodically, and explains that submitted messages are public to everyone while identity remains hidden.

## Verification

Both production frontend builds and backend syntax checks were run. `node scripts/checkStaffLantern.cjs` performs focused role/permission and Lantern-voting checks against an automatically named disposable database on local port 27018. It removes only that temporary database. It checks HTTP responses including Memory acceptance/rejection grants and all-status reads, plus unique votes, announced winner and Wish total. This does not replace the deferred full correctness/capacity and deployment/recovery review. No production deployment or existing-data reset is part of this change.
