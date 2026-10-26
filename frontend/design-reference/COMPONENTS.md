> Historical reference for the previous implementation. Role, voting-key, scheduling and finalist details are superseded by the root README and docs/manual-voting-controls.md.

# Component and callback reference

All presentation is React JSX, with ordinary elements and event handlers. There are no iframes, injected legacy HTML, or `dangerouslySetInnerHTML` calls. API calls belong in `api.js` and state orchestration in `useFestival.js`.

## Top-level composition

### App({ api, fixtureMode = false })

`api` implements the adapter methods below. `fixtureMode` only adds a prominent preview label; it does not change behavior by itself. App owns category selection and which dialog is open. Navigation uses anchors to implemented sections, so no React Router dependency is required.

### createApi({ baseUrl = '/api/v1', fetchImpl = fetch, timeoutMs = 20000 })

Returns async methods: `candidates()`, `settings()`, `register(email, password)`, `login(email, password)`, `me(token)`, `myVotes(token, votingKey)`, `submit(token, votingKey, candidateId, contest)`, `change(...)`, and `remove(token, votingKey, contest)`.

The methods unwrap the documented response envelope. `ApiError` carries `status` and `interrupted`. A 401 is not automatically converted to logout by this transport layer. `fetchImpl` is injectable for contract tests.

### useFestival(api)

Owns public loading/errors, schedule refresh/freshness, registration state, in-memory login session, entered key, independent verified choices, pending mutation lock, and feedback.

Important return values: `candidates`, `candidateState`, `candidateError`, `schedule`, `status`, `session`, `choices`, `choiceState`, `busy`, `notice`, `celebration`.

Important callbacks: `reloadCandidates`, `reloadSchedule`, `register`, `login`, `unlock`, `refreshChoices`, `mutate`, `signOut`, `lockChoices`, `verifyAccount`.

`mutate({ contest, candidate, action })` accepts `submit`, `change`, or `remove`. It checks verified current choices before choosing an endpoint, serializes requests, and obtains authoritative choices afterwards. The UI cannot send another mutation while a request or reconciliation is running.

## Public presentation components

| Component | Props and callbacks | Behavior |
|---|---|---|
| CategorySelection | onSelect(contest) | Two illustrated category buttons; selected state; no data/API access |
| CandidateCard | candidate, selected, onView(candidate), paused | Portrait gallery, API name/batch, details button and private saved-choice badge |
| CandidateProfile | candidate, selected, canVote, actionLabel, onVote(candidate), onClose(), paused, votingStatus | Accessible profile dialog; omits absent nickname/bio/age/zodiac/hobbies; displays only public fields |
| PhotoCarousel | images, name, paused | Up to 3 images; zero-image fallback; crossfade every 5.5s; dots, previous/next, pause/play, touch swipe; hover/focus/reduced-motion pause |
| ScheduleBanner | status, schedule, error, onRetry() | Open/upcoming/closed/unknown state with Myanmar deadlines |
| AccountDialog | initialMode, onClose(), onLogin(email,password), onRegister(email,password), registrationStatus, schedule, onRefreshSchedule() | Validated login/register; one-time returned key; acknowledgement before login |
| UnlockDialog | onClose(), onUnlock(key), busy, sessionPresent | Key input; format validation; wrong-key/error state without automatic logout |
| VoteConfirmation | pending, previous, busy, canConfirm, onConfirm(), onClose() | Explicit casting/changing/removing confirmation naming the affected contest and candidate |
| Celebration | event (timestamp) | Gold crown/swish/confetti acknowledging a saved vote; no prediction of a winner |
| Dialog | title, children, onClose(), locked, className | Native modal dialog with focus containment, Escape handling, body scroll lock and focus restoration |
| Sky / Lantern / Landscape / Crown / Brand | Decorative props as defined in Artwork.jsx | Recovered sky/illustrations and React/CSS artwork; no network/state operations |

`components.jsx` re-exports these for a stable import surface. The UI API consumes the public normalized candidate shape from `domain.js`, not raw database objects. If another agent bypasses the adapter, it must still project public fields and never pass contacts into presentation.

## Real API vs fixtures

- Normal `npm run dev`, `npm run build`, and production use the real HTTP adapter for every interaction.
- Only `npm run dev:fixtures` uses `src/fixtures/fixtureApi.js`; it simulates **all** API methods in memory and labels the page clearly.
- Test suites use controlled fixtures for HTTP responses; no test sends an event vote to a real server.
- Fixtures do not masquerade as a production fallback. API failure shows a visible error/retry state.


See SOURCE-MATCH.md for updated routing, presentation and successful dialog-close callback reasons.
