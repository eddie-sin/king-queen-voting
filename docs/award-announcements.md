# King & Queen announcements

The King & Queen page’s Results tab presents King and Queen first, followed by Mrs Thadingyut (King category) and Miss Thadingyut (Queen category). The recorded ballot counts are never modified by award selections.

In the voting administrator’s Event controls, close voting and open the announcement. The dialog loads the current vote results, lets the operator choose King & Queen, then the Thadingyut titles, and finally review and publish. “Go as default” selects the highest remaining vote total for each title. Every tie at either title position requires the operator to choose one of the tied candidates; IDs are never used as tie breakers. Zero-vote ties also need a decision. A category with only one candidate receives its primary title; an empty category receives none.

“Choose manually” allows any candidate in the matching category, including a candidate with zero votes or an inactive candidate (marked in the chooser). One candidate cannot receive both titles. Publication order follows the chosen titles, even when the King or Queen has fewer votes than the secondary title holder. The real recorded totals remain visible beside each holder.

A staff account with `announcement.open` may fetch `GET /api/v1/admin/announcement-preview` only while King/Queen voting is fully closed and its announcement hidden. This grants a scoped results preview for the announcement workflow; it does not grant `votes.read`, the general vote-totals endpoint, or ballotCount in settings. Other staff and public visitors cannot use the preview. Candidate contact details and the private saved selections are excluded from settings/preview responses.

`POST /api/v1/admin/controls/announcement.open` accepts the usual `revision` and UUID-v4 `operationId`, plus `awardSelection: {mode: "default" | "manual", picks: {king, queen, mrs, miss}}` with candidate IDs. Default picks may be partial when ranks are unique; manual picks must fill every available title. The server computes and validates selections inside the controls transaction. Stale revisions require a new review. Publication saves the IDs, round, choosing account, mode and time in event controls and the audit record. Selections survive service restarts.

While published, title holders cannot be edited. Closing the announcement removes its current selections and hides results; opening again always starts a new review. Old successful command retries never republish a closed announcement. Candidate editing, clearing ballots and reopening voting retain their existing locks. No database migration or additional background process is required.

Validation covers default and manual selections, primary and secondary ties, zero totals, one/zero candidates, duplicate/cross-category picks, stale controls, permission removal, persistence across restart, idempotency, public privacy, and a local browser flow at desktop and mobile sizes. All automated data is disposable local data.
