> Historical reference for the previous implementation. Role, voting-key, scheduling and finalist details are superseded by the root README and docs/manual-voting-controls.md.

# Integration notes for this revision

Files changed: App.jsx, components/Candidates.jsx, components/AccountDialogs.jsx, main.jsx. Added source-match.css and public/art/source-{king,queen,navy-sky}.svg. API, domain and useFestival logic remain unchanged.

App handles #candidates, #king and #queen with browser back/forward. No router dependency. CategorySelection takes onSelect(contest), and renders links. CandidateCard adds optional number display ordinal. CandidateProfile uses the existing props. AccountDialog reports onClose('authenticated') on login; UnlockDialog reports onClose('unlocked') on successful unlock. Other close reasons cancel the remembered candidate. App always requires explicit vote confirmation after authentication. All secrets and pending intent stay in memory.

Source palette: background #0A1625, gold #EDC77D, cream #FFF1D4, muted #97B0CD. Display font Cormorant Garamond; body DM Sans, bundled locally. Exact category illustration SVGs extracted from uploaded index.html; exact source sky copied from navy-sky-de25672168.svg. Decorative artwork is distinct from real API candidates.

Normal dev and production use real API. Only explicit dev:fixtures uses sample names/illustrations and simulated accounts/votes. No automatic fixture fallback. There is no admin panel in this voter-only revision.

Dependencies unchanged: React/React DOM19.2.0, Vite7.1.12, React Vite plugin5.0.4; Playwright1.51.1 test-only. Keep existing vite.config.js and /api + /uploads proxy to backend configured port5002. No backend modifications.
