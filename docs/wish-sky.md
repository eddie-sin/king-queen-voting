# Wish Sky integration

The React Wish Sky from `thadingyut-react-wish-sky.zip` is mounted in the existing voter app at `/#wishes`. `/#wish-sky` remains an alias. Existing King/Queen, finalists, lantern gallery, account, and admin pages remain in place.

## Availability and setup

Wish Sky has no date or time gate. Anyone may read wishes. A signed-in voter can release at most three wishes across the lifetime of the account; a voting key is not needed. The old `WISH_SKY_EVENT_DATE` environment variable is ignored and can be removed from an existing `config.env`.

Run the backend and Vite frontend using the commands in [frontend/README.md](../frontend/README.md). Vite's existing `/api` proxy forwards Wish Sky requests to the backend. Production hosting must likewise route `/api/v1` to the backend; a Vite build by itself does not proxy API calls.

## API contract

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/wishes/status` | Compatibility status; always reports open |
| GET | `/api/v1/wishes?limit=40&cursor=...` | Public message-only feed, newest first; cursor is optional and opaque |
| GET | `/api/v1/wishes/mine` | Account's lifetime `used` and `remaining` allowance; voter Bearer token required |
| POST | `/api/v1/wishes` | Create `{ "message": "..." }`; voter Bearer token required |

The client and backend reject blank messages and impose no wish-specific character cap. The UI displays only the message. The backend's public list and create response contain an opaque ID for feed rotation plus the message; neither returns an owner or timestamp. The database retains the owner and one of three unique slots to enforce the account limit under concurrent requests. The frontend never sends the voting key for wishes.

The public feed uses cursor pagination, 40 wishes per request and at most 24 active lanterns on desktop or 12 on phones. The backend still accepts its previous `page` query for existing clients. New wishes may appear while someone browses; a new feed cycle starts at the newest page.

## Verification

From `frontend/`, run `npm test`, `npm run test:wishes`, and `npm run build`. `test:wishes` uses explicit local fixtures and a browser; it sends no real votes or wishes. `npm run test:wishes:live` runs the browser through Vite, Express and a temporary MongoDB; it needs a local `mongod` executable or `MONGOD_BINARY` set to its path. From the repository root, run `npm test` with the same MongoDB requirement. Both backend and live browser tests start temporary databases and do not use `config.env` databases.
