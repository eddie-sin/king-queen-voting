# Memory Photo — visual preview and connected My Memories

`/#my-memories` uses the real authenticated `GET /api/v1/memory-photos/mine`.
Sign in with the existing festival account flow at `/#account`, then return to
My Memories. It reads the same persisted student session as the voting pages;
no separate token, password store or voting key is introduced. Expired/disabled
sessions are cleared through the existing session writer. A 403 is checked with
`/auth/me` to distinguish feature closure from unavailable student access.
Refresh, window focus, storage events and a 30-second poll recheck metadata;
obsolete requests are aborted/ignored and previous data is hidden during refresh.

The server's limit, acceptedCount and remainingSlots are displayed without
deriving lifetime usage from cards. Only approved records request image bytes,
using the configured backend `/memory-photos/:id/image` URL, never a storage
URL. Pending/rejected submissions use sealed envelopes without image requests.
Archived owner photos use the authenticated owner image endpoint and remain private; they are not requested from the public gallery endpoint. Gallery hearts use the authenticated like APIs. The connected Upload tab submits images for review.

`/#my-memories-demo` explicitly selects sample review states. The existing
Vite fixture mode also shows only clearly labeled samples. `/#memory-gallery`
(alias `/#memory`) is the connected public gallery. `/#memory-gallery-demo`
is its explicitly labeled sample route; `/#memory-upload` is the connected student upload studio; its demo is at `/#memory-upload-demo`.
Demo photos are never substituted for real records, empty data or errors.
These routes mount independently of unrelated festival API hooks. No backend,
AWS or existing authentication behavior is changed. Selected files stay in memory
and are released when removed or when leaving the upload view. Only the explicitly labeled demo studio keeps submission feedback local.

Visual source: `C:\UOS-13\Voting\memory_login`. Original PNG photographs,
logo, desktop/mobile SVG backgrounds and lantern SVG are copied unchanged into
`public/memory-photo/`. Two campus photographs are illustrative; the college
celebration photograph was supplied in the reference. None is represented as a
live approved submission. Existing local Cormorant Garamond and DM Sans fonts
are reused. Confirm publication rights for reference photographs before launch.

`memory.css` scopes every visual selector to `.mp-demo`; it does not modify body
classes or shared navigation/account/Wish Sky styles. The existing `Dialog`
provides modal focus, Escape handling and focus restoration. Motion is short or
finite and disabled by `prefers-reduced-motion`. There are no dislikes, editable
captions, profiles, date gates or new packages.

Verification from `frontend/`:

```powershell
npm test
$env:VOTING_API_TARGET = 'http://127.0.0.1:1'
npm run build
node tests/memory-browser.mjs
node tests/memory-mine-browser.mjs
```

The explicit API target prevents Vite from consulting `config.env`; the browser
test also sets it internally and blocks backend traffic. No assets used by the
demo are missing. The demo is a direct-link preview; the existing festival
navigation remains unchanged for this phase.

For a connected preview, run your backend with the new `/mine` endpoint, then
start Vite with `VOTING_API_TARGET=http://127.0.0.1:5002` (use your backend port).
Open `/#my-memories`. The localhost:1 target above is only for isolated tests and
builds; it deliberately cannot reach a real backend. Browser tests intercept all
API responses and use fixture sessions, including desktop/mobile status cards,
quota/empty states, disabled/expired access, network retries, image errors and
sign-out during delayed responses. They make no real account or AWS calls.

Verification note: the older voting browser suite currently fails its mock's
Bearer assertion for an anonymous public request; the identical failure was
reproduced with the unmodified `origin/main` App served in memory. The existing
Wish Sky browser suite also encountered overlapping lantern hit targets when
run with local Edge (its default Playwright browser is not installed). Neither
unrelated suite nor their application code was changed. Memory's dedicated
browser tests, the frontend unit suite and production build pass independently.

## Connected All Memories (Phase 3)

The anonymous gallery requests `GET /api/v1/memory-photos?page=1&limit=20`.
Previous/Next follow the backend's `pagination.page` and `hasMore`; no total is
invented. Each card displays the supplied `likeCount`; authenticated hearts also use the like-status and like/unlike APIs described below. Metadata is strictly validated and
projected to id, createdAt and likeCount; storage URLs, identities and moderation
fields are discarded. All image URLs use the existing Express image adapter.
Loading, empty, disabled, malformed/network and image failures never fall back
to demo photographs. Focus and a 30-second refresh recheck availability and hide
old content while loading; obsolete requests are aborted/ignored. Backend image
checks remain authoritative. The original decorative lantern replaces demo
photography in the live hero; original backgrounds, fonts and card styles remain.

Preview: point `VOTING_API_TARGET` at the local backend before starting Vite,
then visit `http://localhost:5173/#memory-gallery` (or the port Vite reports).
No sign-in is needed. Use `/#memory-gallery-demo` for sample images.
Run `node tests/memory-gallery-browser.mjs` for intercepted HTTP browser checks
on desktop/mobile, including pagination, counts, keyboard viewer, loading,
disabled, malformed/network, empty/image errors and demo isolation. This does
not contact MongoDB or AWS. Unit tests and the production build also pass.

## Connected Upload studio (Phase 4)

Sign in at `/#account`, then visit `/#memory-upload`. It uses the same student
session and `/memory-photos/mine` quota as My Memories. The three-slot studio
previews JPEG/PNG/WebP files up to 5 MiB each; selection and submission are
bounded by the server's remainingSlots for active pending/approved photos;
rejected and permanently deleted submissions release their slot.
Client validation is a convenience; backend file-content validation remains authoritative.

Submission rechecks quota, sends one `images` FormData file per request,
sequentially, and leaves multipart Content-Type to the browser. File-by-file
progress/results remain visible after partial success. Confirmed submissions
show PENDING envelopes; the My Memories link fetches fresh server history.
Quota is refreshed after conclusive results and after the batch. No storage keys
or URLs are used. Files are never automatically retried. Ambiguous network/server
or malformed success results stop the batch and block that selection from retry;
check My Memories before removing/reselecting it. The API has no client idempotency
key, so it cannot safely guarantee deduplication of a manually reselected file.
Session expiry, feature closure and quota conflicts also stop further uploads.
Unmount/sign-out aborts in-flight work; an already accepted request may still
finish on the backend. Check history when returning. Preview URLs are revoked on
removal, success, account change and unmount. Gallery/My Memories remain separate.

`/#memory-upload-demo` keeps the original local-only previews. No demo action
sends real uploads. Dedicated checks: `node tests/memory-upload-browser.mjs`;
all HTTP requests are intercepted with generated fixture sessions, not live
accounts or AWS. Start Vite with `VOTING_API_TARGET=http://127.0.0.1:5002`
(adjust backend port), open `http://localhost:5173/#account`, sign in and visit
`http://localhost:5173/#memory-upload`. Backend must enable Memory Photo.

## Connected hearts (Phase 5B)

Public metadata/counts and approved image bytes stay anonymous. Signed-in
students fetch one like-status batch for the displayed page. Omitted, loading
or unavailable states keep hearts neutral/disabled. POST adds a like; DELETE
removes it. Both the card and enlarged viewer use the returned liked/likeCount,
without locally incrementing a counter. Only successful new likes animate; reduced
motion suppresses the animation. One mutation per photo may be in flight.

The existing session writer emits a local change notification so logout and
account switches immediately remove personalized state. Storage/focus changes
and a fallback poll also synchronize it. Aborted/stale page/account responses
cannot restore hearts or overwrite counts. An uncertain mutation is not replayed;
public metadata and status are fetched again. Expired tokens clear the existing
session. Missing photos trigger a gallery refresh; disabled or unavailable likes
show a message. Anonymous heart clicks open the existing account route; after
sign-in, the user returns to All Memories. No vote or like is automatically cast.
The return intent lasts only in this app instance and is abandoned if the user
leaves the account route. Demo hearts remain local to labeled demo routes.

Preview at `http://localhost:5173/#memory-gallery` after starting Vite with
`VOTING_API_TARGET=http://127.0.0.1:5002` (use your backend port). Memory Photo
must be enabled. Sign in through an anonymous heart or the existing account page.
Run `node tests/memory-likes-browser.mjs` for mocked HTTP checks of login return,
response counts, refresh/pagination, pending/failed states, account switches,
stale responses, keyboard operation and reduced motion. No real accounts or AWS
are used by the checks.
