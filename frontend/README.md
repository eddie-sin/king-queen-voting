# Student website — manual controls version

See the [current root README](../README.md) for setup and API contracts. This branch uses email/password sign-in, one final King vote and one final Queen vote, manual event status and actual candidate totals. No voting key or date schedule is used. Memory Photo, Lanterns, wishes and music keep their existing roles.

`npm run dev` uses the configured local API proxy. `npm run dev:fixtures` provides an isolated visual preview with fake accounts/votes. `npm run build` creates the production website. Old test files still describe the previous contracts; their rewrite and correctness/capacity verification are deferred to the next phase.

Public pages open in Burmese. The header's English / မြန်မာ button switches all public pages and saves the choice in `festival-language`. Admin pages stay in English. Translations live in `src/i18n/messages.js`; components use `useT()` for interface copy and leave visitor messages, names and uploaded content untouched. Memory dates follow the selected language and Myanmar time.

Write Burmese as short, natural interface copy. Keep the English meaning and the existing line breaks; avoid expanding labels into sentences. Allow enough line height and vertical separation for Burmese's stacked marks. `npm run test:language-layout` compares both languages at six screen widths, including the navigation drawer and public dialogs. It checks line counts, horizontal fit, and actual gaps between titles, subtitles, captions and form fields. Measurement reports are saved under `test-artifacts/language/`.

Run `npm test` for unit checks, `npm run test:browser` for voting flows, and `npm run test:language` for all public routes in both languages at desktop and phone widths. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using a locally installed browser. Existing English browser regressions explicitly select English; the language suite checks the Burmese default, persistence, dialogs and preservation of drafts.
