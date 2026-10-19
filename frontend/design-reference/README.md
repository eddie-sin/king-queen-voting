# Thadingyut React — source-matched King & Queen revision

Uses the King & Queen page in the attached thadingyut-dark-blue-netlify.zip. Replaces the previous combined scrolling layout.

## Restored workflow

1. #candidates: original heading, two large arched King/Queen cards, instructions.
2. #king / #queen: separate galleries, category tabs, numbered cards and Meet [name] buttons.
3. Open profile with one-to-three photos, swipe/slideshow and available personal details.
4. Sign in to vote remembers the candidate through login and key entry, then asks for explicit confirmation. Cancelling returns to that profile. Authentication never casts a vote.
5. Successful saves return to the profile with saved-crown status and sparkle/confetti.
6. Voting stays in the King and Queen candidate flow; signing out is available in the header.

## Backend-required differences from the static demo

Real email/password authentication replaces any-credentials login. Registration displays a one-time key and requires save acknowledgement before separate login. Token/key stay only in memory. Schedule deadlines and protected choices remain enforced. Interrupted mutations refresh saved choices before retrying. Names/photos come from the API; missing biography/gender is never invented. There are no rankings, unrelated pages or public admin links.

Exact uploaded sky and category SVG artwork are included. source-match.css loads last to match the source dimensions, typography, colors, cards and responsive layout. Existing API access stays separate from presentation. No iframe or raw HTML injection.

## Start here: existing repository

1. Keep the repository's existing `frontend/vite.config.js`. It already proxies `/api` and `/uploads` to the configured backend (currently port **5002**). This package intentionally supplies only `vite.config.example.js`, so copying the handoff will not overwrite that configuration.
2. Merge `frontend/src/`, `frontend/public/art/`, and `frontend/public/fonts/` into the existing frontend. Replace the entry point and application styling intentionally; do not load the old app's CSS beside this theme. Use `frontend/index.html`, or keep an existing equivalent HTML entry with `#root` and `/src/main.jsx`.
3. Merge the dependencies and scripts below into the existing `frontend/package.json`. Do not discard unrelated dependencies or change backend packages. The included lockfile is for a clean standalone installation; regenerate the existing repository's lockfile after merging its package.json.
4. Start the existing backend using its existing command. Do not change its port, routes, database configuration, authentication, or deadlines.
5. From the repository's `frontend/` directory:

```sh
npm install
npm run dev
```

Production build:

```sh
npm run build
```

The frontend uses relative `/api/v1/...` and `/uploads/...` URLs. No request hardcodes a backend port. Vite's development proxy is not a production proxy; retain the repository's existing production reverse proxy/static hosting arrangement for these paths.

## Standalone source preview

The ZIP can be tested without the repository or backend. From this package's `frontend/`:

```sh
npm ci
npm run dev:fixtures -- --config vite.config.example.js
```

This starts a visibly labelled, local-only fixture experience. It does not send real votes. Example fixture login:

- Email: `demo@example.test`
- Password: `festival123`
- Voting key: 64 lowercase `a` characters. This is a public test value, never a real key.

You can also register a new fixture account, receive a one-time key, acknowledge saving it, log in, unlock, cast, change and remove both choices. All fixture data disappears when the page refreshes.

To use the real API in a standalone checkout:

```sh
npm run dev -- --config vite.config.example.js
```

The reference config proxies `/api` and `/uploads` to `http://localhost:5002`. It is not a replacement for the existing repository's configuration.

Build the standalone package:

```sh
npm run build -- --config vite.config.example.js
npm run preview -- --config vite.config.example.js
```

`preview` serves the built files. To exercise protected production API calls, serve the build using the existing repository's production routing. Do not enable fixtures as a fallback for API failures.

## Files

```text
thadingyut-react-source-matched/
  README.md
  COMPONENTS.md
  VERIFICATION.md
  ASSETS.md
  previews/                     desktop/mobile fixture screenshots + profile dialogs
  frontend/
    package.json
    package-lock.json
    index.html
    vite.config.example.js        reference only; existing vite.config.js stays intact
    .env.fixtures                 used only by dev:fixtures
    .gitignore
    public/
      art/
        source-navy-sky.svg       exact supplied navy sky artwork
        source-king.svg           exact decorative category illustration
        source-queen.svg          exact decorative category illustration
      fonts/
        *.woff2                   locally hosted Cormorant Garamond + DM Sans
        *-LICENSE.txt
    src/
      main.jsx                    production vs explicit dev-fixture composition
      App.jsx                     page layout and dialog orchestration
      components.jsx              stable re-export entry
      api.js                      all HTTP access; no presentation
      domain.js                   public data projection, deadlines, time formatting
      style.css                   font faces, palette, controls, base styles
      festival.css                layout, artwork, responsive rules, animation
      hooks/
        useFestival.js            session, key, choices and request state
      components/
        Artwork.jsx
        Dialog.jsx
        PhotoCarousel.jsx
        Candidates.jsx
        AccountDialogs.jsx
        Voting.jsx
      fixtures/
        fixtureApi.js             development-only in-memory adapter
    tests/
      api.test.js
      domain.test.js
      browser.mjs                 isolated HTTP fixtures; starts its own Vite server
      capture-preview.mjs         optional, explicitly labelled fixture screenshots
```

## Dependencies

| Kind | Package | Included version | Purpose |
|---|---|---|---|
| Runtime | react | 19.2.0 | Components and hooks |
| Runtime | react-dom | 19.2.0 | Browser rendering |
| Development | vite | 7.1.12 | Development and build |
| Development | @vitejs/plugin-react | 5.0.4 | React JSX and refresh |
| Test only | playwright | 1.51.1 | Browser integration checks |

Use a compatible Node runtime: **20.19+ on Node 20, or Node 22.12+**. A Node 22 LTS runtime is a straightforward choice. If the existing repository already has compatible React/Vite packages, keep its versions where practical and run the checks after merging. There is no router, CSS framework, animation package, icon package, Axios, external font request, analytics, or runtime UI dependency beyond React/React DOM.

The original fonts are included as WOFF2 files, with their licenses. No font download is needed at runtime. The Latin font subsets match the original English interface; non-Latin candidate names fall back to the visitor's system fonts.

## API wiring

Every operation goes through `src/api.js`. Default base URL: `/api/v1`.

| UI operation | API |
|---|---|
| Browse active candidates | GET `/candidates` |
| Load / refresh deadlines | GET `/settings` |
| Register | POST `/auth/register` with email, password |
| Login | POST `/auth/login` with email, password |
| Check participation / verify login | GET `/auth/me` with Bearer token |
| Unlock / refresh choices | POST `/voting/my-votes` with votingKey and Bearer token |
| First vote | POST `/voting/submit` with votingKey, candidateId, contest |
| Change vote | PATCH `/voting/change` with the same fields |
| Remove vote | DELETE `/voting/remove` with votingKey, contest |

All protected calls use the Bearer token. All HTTP failures are handled regardless of JSON status text. Votes are selected by lowercase `king`/`queen`. Private contact fields are excluded by a public-field projection before they reach components. Optional profile details render only when present.

The client uses `fetch`, a 20-second timeout, no persistent storage, and no request logging. On uncertain writes it never automatically repeats the mutation. It refreshes saved choices, then asks the user to review; if refresh fails, additional mutations stay locked until choices can be verified. A key-related 401 triggers `/auth/me` to distinguish a wrong key from an expired token.

## Session and key behavior

- Browsing is public. Login alone does not unlock voting or reveal selected candidates.
- Registration does not log in. The returned key is displayed once in a non-dismissible dialog. Continuing to login requires the user to affirm they have saved it. Refresh loses the one-time display.
- Token and entered key exist only in React memory/refs. Refresh and sign-out clear them. No localStorage, sessionStorage, cookies or URL parameters carry secrets.
- Key copy is an explicit user action using the clipboard. Manual selection is available if clipboard access fails. The user must privately save this key outside the app.
- Existing participation flags remain visible outside the voting period, but selected candidate identities are hidden and the entered key is cleared when the period is not open or its schedule becomes unverified.
- Registration closing is checked independently from voting closing.
- Schedule is refreshed every 30 seconds and on window focus. The UI clock checks boundaries every second. Missing/invalid/stale schedule information disables voting; the backend remains authoritative.
- Dates display Myanmar time (`Asia/Yangon`, MMT), including the date and year.
- A registration interrupted after server commit may lose its one-time key. The UI warns the user and prevents an automatic retry. Recovery is not invented; it requires the organisers' existing process.

## Explicit fixture scenarios

In `.env.fixtures`, optionally add `VITE_FIXTURE_SCENARIO=` with one of:

- `open` (default)
- `upcoming`
- `closed`
- `registration-closed` (voting still open)
- `empty`
- `error` (candidate API error)
- `schedule-error`
- `interrupted` (first mutation commits but simulates a lost response)

Restart Vite after editing the environment file. The fixture import is gated by **both** `import.meta.env.DEV` and `VITE_USE_FIXTURES=true`; a production build always uses the real API and tree-shakes the fixture module. There is no automatic fixture fallback.

## Validation commands

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build -- --config vite.config.example.js
```

The browser suite starts and closes its own Vite server and intercepts API requests. It does not require or modify the real backend. Alternatively point `TEST_BASE_URL` at a running normal-mode Vite frontend when appropriate; do not run this suite against a fixture-mode page because the suite specifically exercises the real HTTP adapter.

## Integration boundaries / remaining verification

The existing backend repository and a live API were not available here. This is a complete frontend implementation against the supplied contract; the integrating agent still needs to verify it against real middleware, real candidate uploads, actual scheduled deadlines, and the backend's error responses.

No backend files, database settings, credentials, voting rules, deployments, or Git remotes were changed. No public rankings or winner predictions are included. Lantern exhibition, Wish Sky, program, results, developer team and other festival pages are intentionally outside this scoped frontend. Navigation points only to implemented sections.

Actual candidate photos and names must come from the real API. The included category artwork is decorative; fixture previews reuse it as explicitly labelled sample imagery. An empty API image list shows “Photo coming soon”; failed image loads show “Photo unavailable”.

The signup security disclosure avoids promising a backend deletion policy that is absent from the contract. Organisers should supply verified retention wording if they want an event-data deletion date shown.
