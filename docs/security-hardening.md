# Security changes October 2026

The student sign-in, Google, OTP, voting and photo-moderation flow remains in place.

- Staff can change their own password or end all sessions under Account security. Both actions require the current password and revoke that account's existing tokens. New staff passwords require at least 15 characters, at most 72 UTF-8 bytes, and cannot be a listed common password. Existing student passwords and session lifetimes are unchanged.
- Full administrators can pause new wishes and hide/restore wishes under Wish Sky. Existing content is preserved when posting pauses. Hidden wishes keep their account slot and remain labelled in the owner's My Wishes. Open public displays refresh moderation changes within 30 seconds or on focus; content already downloaded cannot be recalled.
- New wishes allow 280 grapheme clusters, eight lines and 8 KB. Burmese combining marks and emoji are supported. Existing longer wishes remain readable and moderatable.
- One image upload buffers/processes at a time, with eight waiting requests and up to three requests per account. Waits expire after six seconds and admissions are capped at twenty per account/minute. Quota is checked before image decode and errors preserve confirmed cancellation/reconciliation behavior.
- Staff images are decoded and re-encoded to reject corrupt/spoofed content and remove EXIF. Existing stored images are not rewritten by deploying this code. Three candidate images and ten gallery images remain supported.
- Archived Memory Photos are hidden from the public gallery. Authorised moderators retain access and see the correct ARCHIVED label. Staff moderation/deletion has an audit trail and mutation-time permission checks.
- API body limits at Nginx: 64 KB general API, 6 MB Memory upload, 16 MB candidate upload, 55 MB gallery batch. Individual image limit remains 5 MB. Multipart fields are bounded.
- Rate-limit state is isolated by route class and source; logout does not compete with login. Persistent password attempt accounting uses inbox plus source and a generous account-wide ceiling. Password workers remain bounded; email quotas are unchanged.
- Non-control-dependent authentication and mail-budget operations no longer write the shared voting fence. Registration and voting operations retain control fencing. Public calculations are bounded, briefly memoized, and never cache access decisions or personal images. Wish cursor pagination is retained; numeric pages are limited to 100.
- Privacy is public before sign-in. CSP is report-only while compatibility is evaluated, so it does not block Google, fonts, media or previews. No CSP report collector or new paid service is installed.

## Validation

Run `npm run test:all` with the installed local test binaries. Tests use generated credentials, fake mail, temporary replica sets and owned directories; never use Atlas or the live application for automated tests. `npm run test:auth` also exercises the new administrator security UI in a disposable local browser fixture. The additional frontend `test:wishes` and `test:wishes:live` scripts check Wish UX; the latter's name refers to a real disposable local API, not production.

Deploy only an exact clean commit after checks pass. Inspect current event controls before restarting: startup closes interrupted voting windows. Preserve the protected production JWT, OTP and mail secrets unless a separately planned rotation is required. Bootstrap password settings do not update an existing administrator.

## Development credentials

Routine development should use an isolated local replica set and local image storage. The maintained tests already generate separate secrets and fake providers without loading config.env. Keep production database, AWS and email credentials out of routine teammate configurations and private handoff material out of Git. EC2 uses its instance role. A targeted production account credential update is an operator action, not an automatic seed migration; deliver replacement access privately and revoke the old account sessions.
