# Memory Admin provisioning and permissions

Admin accounts have a database role: `ADMIN` (full administrator) or
`MEMORY_ADMIN` (Memory Photo moderator). New/legacy accounts with no role default
to ADMIN, preserving existing permissions and JWTs without a migration. Invalid
stored roles are denied by authorization. No admin role is read from request
bodies, query parameters, custom headers, or JWT permission claims.

## Provisioning

Only a full ADMIN may call `POST /api/v1/admin/memory-admins` with its existing
Admin Bearer JWT and this JSON shape:

```json
{ "username": "<new moderator username>", "password": "<privately supplied password>" }
```

The server always creates MEMORY_ADMIN, hashes the password with bcrypt cost 12,
and returns HTTP 201 with `data.admin: { id, username, role, status }`. It returns
neither a password/hash nor a token. A username must be nonempty after trimming
and at most 100 characters; password length is at least eight characters and at
most 72 UTF-8 bytes. Extra fields (including role/status/passwordHash) return 400;
duplicate usernames return 409. Use HTTPS outside localhost, choose a unique
strong password privately, and deliver it through an appropriate private channel.
No hardcoded or generated account credentials are committed to the repository.

There is no public administrator registration or client-selectable administrator
role. MEMORY_ADMIN cannot provision itself or another moderator. Role changes,
password resets and administrator account-management endpoints are not added by
this task; existing controlled operational procedures remain necessary.

## Login and authorization

Both roles use `POST /api/v1/auth/admin/login` with username/password. The JWT
still uses `role: "admin"` to identify an Admin account (compatibility with old
tokens); it is not a full-admin permission grant. Login now reports the stored
role at `data.admin.role`. The authorization middleware reloads the account and
checks active status and current database role for every protected request.
Database permission changes therefore apply even to already-issued tokens.

| Capability | ADMIN | MEMORY_ADMIN |
| --- | --- | --- |
| List pending `/admin/memory-photos` | Yes | Yes |
| Read private `/admin/memory-photos/:id/image` | Yes | Yes |
| Approve/reject `/admin/memory-photos/:id/review` | Yes | Yes |
| Read/change `/admin/settings`, including Memory Photo switch | Yes | No |
| Provision `/admin/memory-admins` | Yes | No |
| Protected contestant and existing gallery management | Yes | No |
| Student voting, submissions or likes using an Admin JWT | No | No |

Memory moderation remains available while the feature is disabled. Review audit
fields continue to reference the actual Admin document via reviewedBy and record
the server timestamp. No duplicate identity or moderator model is introduced.

Existing anonymous public endpoints (public settings, contestants, released
results and approved Memory Photos while enabled) remain public. A moderator
cannot gain privileged access through them; public data is still accessible
without any account. The admin router defaults to full-admin authorization after
the three explicitly allowed moderation routes, so future full-admin routes do
not accidentally inherit moderator access. Other protected routers continue to
use the full-admin middleware.

## Postman

The main collection provisions a new Memory Admin using the full-admin
token, logs it in at the same admin login endpoint, and uses its runtime-local
`memory_admin_token` for moderation. Set `memory_admin_username` (unique for each
run) and `memory_admin_password` privately in the blank environment template.
Enable/disable stays on `admin_token`. The collection includes full-admin
moderation access and restricted-role denial checks. Tokens are not saved by
scripts to exported environment files. See the [testing guide](memory-photo-postman-guide.md).

Final isolated integration validation on 2026-10-19: 76/76 requests and 219/219
assertions passed, including positive full-admin permissions and restricted-role
denials. The first approval and final rejection use MEMORY_ADMIN; the second
submission's rejection uses ADMIN, preserving audit coverage for both roles.
The sanitized per-request report remains local as
`postman/Memory-Photo.integration-results.json` and is excluded from commits.
