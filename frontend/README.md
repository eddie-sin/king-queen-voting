# Thadingyut voting frontend

React voting frontend imported from `/home/nikolai/thadingyut-react-source-matched.zip` and connected to the existing Express API. Nothing is deployed by these commands.

## Run locally

Use Node.js 20.19+ or 22.12+ (this implementation was built with Node.js 26). Start your normal local MongoDB service. In a terminal at the repository root:

```sh
npm ci
npm run dev
```

Use the existing ignored `config.env`, with your backend `PORT` and a working `DATABASE_LOCAL`. Do not copy backend secrets into the frontend.

If MongoDB is not installed, you can run it locally with Docker instead:

```sh
docker run -d --name king-queen-mongo --restart unless-stopped \
  -p 127.0.0.1:27017:27017 \
  -v king-queen-mongo-data:/data/db mongo:8.0
```

On this machine Docker bridge networking is unavailable (`veth ... operation not supported`), so the container was started using host networking and an explicit localhost bind instead:

```sh
docker run -d --name king-queen-mongo --restart unless-stopped \
  --network host -v king-queen-mongo-data:/data/db \
  mongo:8.0 mongod --bind_ip 127.0.0.1
```

Use only one of these creation commands, not both. A failed bridge attempt is retained as `king-queen-mongo-bridge`; the working container is `king-queen-mongo`.

Run the creation command only once. On later visits, use `docker start king-queen-mongo`. The named volume preserves the database when the container stops. If nodemon previously crashed with `ECONNREFUSED 127.0.0.1:27017`, enter `rs` in its terminal after MongoDB starts. Your local connection string can remain `mongodb://127.0.0.1:27017/king_queen_voting`.


In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open the local URL Vite prints (normally http://127.0.0.1:5173). Vite forwards `/api` and `/uploads` to the port in the backend’s `config.env` (falling back to 5000). Restart Vite after changing that file. You can override the target with `VOTING_API_TARGET=http://127.0.0.1:5002 npm run dev`. Backend secrets are never exposed to the browser.

## Check the page

- Browse both contests, open profiles, and switch portrait photos. Missing photos have a fallback.
- Register with an unused test email and an eight-character password. Save the one-time voting key. Registration does not sign you in automatically.
- Sign in, unlock choices with the key, then open a candidate and confirm your vote.
- Vote once for King and once for Queen. Move either crown to another candidate; the other contest should remain unchanged.
- Remove a vote using “Remove King vote” or “Remove Queen vote”; vote again.
- Try a wrong key, cancel confirmation, and refresh. Refresh deliberately clears both login and the in-memory voting key.
- Check a narrow mobile viewport, keyboard Tab/Escape, and reduced-motion settings.
- Stop the API and reload to check the connection error and retry action.

The default voting window is October 28–November 2, 2026, in Myanmar time. Before it opens, the page correctly disables voting. For a complete vote test before then, use a **separate local test database**, add candidates first, and then change its schedule to include the current time through the admin settings API. Starting voting permanently locks candidate management in that database. Do not change a real election just for testing.

### Prepare test data with the existing API

The backend does not seed candidates. Use your API client (for example Postman) with base URL `http://127.0.0.1:PORT/api/v1`, replacing `PORT` with the value in your backend’s `config.env` (currently 5002 on this machine):

1. `POST /auth/admin/login` with your local `ADMIN_USERNAME` and `ADMIN_PASSWORD`; use `data.token` as a Bearer token for the next two requests.
2. Before opening voting, `POST /candidates` for at least two kings and two queens. Example JSON:

```json
{
  "fullName": "Test King One",
  "batchNumber": "2026",
  "nickname": "Test candidate",
  "images": ["https://placehold.co/600x800/193752/edc77d?text=Test+Candidate"],
  "bio": "Local testing profile",
  "contactNumber": "test-only",
  "category": "king"
}
```

Use `category: "queen"` for queens. You can also upload real local test images through the backend's multipart `images` field.

3. `PATCH /admin/settings` with ISO strings using the `+06:30` offset. Set `votingOpensAt` before now, `votingClosesAt` after now, and `resultsPublishedAt` after closing. Set `registrationClosesAt` after now if testing registration. Reload the page after changing settings.

The page refreshes settings every 30 seconds. The API always enforces the actual deadlines.

## Build

```sh
npm run build
npm run preview
```

`dist/` is ignored. Preview is a static build server: run the API too. A matching proxy is configured for local preview.

Production should route `/api` and `/uploads` to the API on the same origin. API requests are relative to `/api/v1`; the existing Vite configuration handles local development and preview routing. Backend credentials stay in the backend.

Login tokens and voting keys stay in React memory only. Do not add request-body analytics or logging to voting operations. The frontend displays no live rankings or final-winner predictions.

## Imported frontend connection

The design and components now come from `thadingyut-react-source-matched.zip`, including its bundled artwork and local fonts. Normal `npm run dev` uses the real API for candidates, settings, registration, login, participation status, and all voting operations. The original Vite backend-port detection is preserved (currently port 5002).

- `src/api.js`: HTTP adapter for the existing API.
- `src/hooks/useFestival.js`: account, key, choices, and voting state.
- `src/App.jsx` and `src/components/`: the supplied React UI.
- `src/style.css` and `src/festival.css`: the supplied design.
- `public/art/` and `public/fonts/`: the supplied artwork and local fonts.
- `design-reference/`: the original handoff notes and screenshots.

Fixture mode is separate and explicitly enabled using `npm run dev:fixtures`. It never activates as a fallback for API errors. Use normal `npm run dev` to connect to your real backend.

Backend source, credentials, election settings, and database contents have not been changed by this frontend import. No commit or push has been made.
