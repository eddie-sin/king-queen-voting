# Imported pages, titles and manual vote totals

Home and Developer pages/assets were taken from `origin/sa-yar-gyi` at `a1e713f`. The current branch's App, account flows, manual controls, Memory integration and Lantern voting were preserved. Home links to the existing Memory gallery rather than a coming-soon placeholder. Developers are reachable through Home's Meet the developers link and `#developers`.

Public King/Queen announcement now returns only up to two positively voted candidates per category. Titles use the requested spellings: first King **Mrs Thadingyut**, first Queen **Miss Thadingyut**, second King **Prince**, second Queen **Princess**. Each displays the recorded count. A category without enough positively voted candidates leaves the missing title unawarded. Ties affecting either first or second position block announcement (including a tie between second and third); a name/ID sort never chooses the title. Close voting, hide announcement and reopen for additional votes if a tie needs resolving. Results are derived from ballots, without result snapshots or random selection.

New optional permissions, default off:

- `votes.read` for voting administrators: `GET /api/v1/admin/vote-totals`.
- `lantern.votes.read` for Lantern administrators: `GET /api/v1/admin/lantern-vote-totals`.

The higher administrator grants these in Staff accounts. They do not grant public announcement access or cross-role access. Both APIs return all candidates/lanterns with counts, including zero, plus a capture timestamp. Reads use a database transaction for a consistent snapshot and never include individual voters. They are available whether voting is open or closed. The frontend fetches only when Refresh totals is clicked; its normal five-second control polling does not refetch totals. Revoked permissions hide the panel and deny further API reads.

## Verification

Both website production builds passed. The focused disposable local replica-set check passed 69 HTTP assertions plus title/count/tie checks. Browser checks verified the Home hero image, Developer page/dialog, manual-only totals fetching across background polling, and permission revocation hiding the view. These focused checks do not replace the deferred full correctness/concurrency/capacity phase. No production database, main branch or live deployment was changed.
