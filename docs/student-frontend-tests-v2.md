# Student frontend v2 test migration

The student frontend now follows server-owned `EventControls`, account-bound JWT
sessions and permanent per-round ballots. Phase 3A retires these legacy test
assumptions:

- Fixed registration/voting/result dates are replaced by `registrationOpen`,
  `votingStatus`, `announcementOpen`, `round`, `window` and `revision`.
- Voting keys are removed. Student JWT identity is the only voting identity.
- Vote change and removal operations are removed. A submitted King or Queen vote
  is final for that round; an exact retry is idempotent.
- Timed/randomized finalists are replaced by explicit administrator announcement
  and ranked result entries containing official vote totals and titles.

Replacement unit coverage lives in `api.test.js`, `domain.test.js`,
`finalists.test.js` and `session.test.js`. Existing Memory Photo, Wish Sky and
Lantern tests remain separate and continue to execute through `npm test`.

Phase 3B migrated the executable Playwright coverage. `tests/browser.mjs` now
loads `tests/browser-v2.mjs`, which models manual controls, JWT sessions, permanent
round votes and explicit result announcements. `tests/memory-live-browser.mjs`
uses a disposable local replica set, v2 staff provisioning/control commands and
private local image storage. `tests/memory-likes-browser.mjs` uses the v2 settings
shape and current account selectors. The original v1 browser body remains inside
a non-executed block in `tests/browser.mjs` solely as a temporary review record.
