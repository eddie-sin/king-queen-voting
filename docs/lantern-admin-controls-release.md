# Lantern Admin Controls – Release Notes

This branch adds the Lantern-specific vote reset permission and dashboard controls.

## Verification

- Admin unit tests: 4/4 passed.
- Student frontend tests: 53/53 passed.
- Admin and student production builds passed.
- Backend syntax checks passed.
- The backend Lantern integration suite remains unexecuted because the disposable Windows MongoDB fixture cannot start (`mongod` launch reports `ENOENT`). No production database or S3 object was used.

The reset command remains protected by server-side role/permission checks, revision fencing, operation IDs, transaction handling and the requirement that voting is closed and the winner announcement is hidden.
