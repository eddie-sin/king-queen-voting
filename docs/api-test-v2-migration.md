# Legacy API test migration to v2

`test/api.test.js` previously exercised the retired Election, fixed-schedule,
finalist and voting-key architecture. The historical entry point remains in
that file; its current executable cases live in
`test/apiV2.cjs`. They use the random disposable replica set and local storage
owned by `test/fixtures/v2Fixture.cjs`.

## Case-by-case classification

| Former test | Classification | Current executable coverage |
| --- | --- | --- |
| Startup dates and hashed admin | Changed contract | `authentication.test.js`: v2 seed, hashed ADMIN and restart |
| Memory setting enable/disable | Superseded | `memoryPhotoV2.test.js` feature gates and `adminRolesV2.test.js` grants |
| Memory Boolean validation | Changed contract | Command validation in current role/control suites |
| Anonymous/user Memory setting denial | Superseded | `adminRolesV2.test.js` cross-account restrictions |
| Old Election without Memory field | Retired architecture | Required v2 `EventControls` in a clean database |
| Memory setting plus date update | Retired architecture | Command controls replaced date mutation |
| Candidate public/admin CRUD | Still applicable | Migrated general API suite |
| Candidate/gallery mutation authorization | Still applicable | Migrated suite; role matrices stay focused |
| Registration creates voting key | Changed contract | `authentication.test.js` safe response without keys |
| Account/credential rollback | Retired architecture | Credential model removed; v2 registration rollback is tested |
| Key ownership and key-operation JWT | Retired architecture | Account-bound ballots and account-kind isolation suites |
| Vote change/removal/revote | Retired behavior | Permanent round votes in `votingControlsV2.test.js` |
| Invalid/inactive/wrong-category vote | Changed contract | `votingControlsV2.test.js` |
| Scheduled key-operation window | Retired architecture | Manual/stale windows in voting v2 suite |
| Disabled/deleted user JWT | Superseded | `authentication.test.js` |
| Concurrent submission/removal | Changed contract | Permanent concurrent ballot tests |
| Participation-flag rollback | Retired architecture | Flags removed; transaction rollback remains tested |
| Candidate-management date closure | Changed contract | Manual voting/announcement locks |
| Voting override and pre-event clear | Changed contract | Explicit commands, rounds and retry safety |
| Candidate write crossing upload/deadline | Changed contract | Transactional mutations here; manual locks in voting suite |
| Admin date validation | Retired architecture | No v2 date-edit endpoint |
| Finalists/randomized cutoff | Retired behavior | Ranked announcements and tie rules replaced finalists |
| Results finalization after downtime | Changed contract | Explicit announcement and restart tests |
| Legacy unbound key | Retired architecture | No v2 voting keys |
| Deadline compensation | Changed contract | Transaction rollback and stale-window tests |
| Revoked key/admin-as-voter | Changed contract | Account-kind isolation tests |
| Standalone Mongo startup | Retired architecture | v2 intentionally requires a replica set |
| Failed vote change/removal restoration | Retired behavior | Vote changes/removals unsupported |
| Participation-flag repair | Retired architecture | Participation flags removed |
| Concurrent finalist persistence | Retired behavior | Finalist draw removed |
| Candidate/gallery local upload and serving | Still applicable | Migrated suite |
| Titled Lantern creation | Superseded | `lanternControlsV2.test.js` |
| Lantern write validation | Superseded | `lanternControlsV2.test.js` |
| Lantern authorization/legacy gallery | Split | Lantern focused suite; generic gallery migrated here |
| Registration validation | Superseded | `authentication.test.js` |
| Wish visibility/auth/three-slot limit | Still applicable | Migrated suite |
| Wish cursor pagination/privacy | Still applicable | Migrated suite |
| Candidate photo lifecycle | Still applicable | Migrated suite |
| Unsafe photo edit validation/cleanup | Still applicable | Migrated suite |
| Shared candidate photo retention | Still applicable | Migrated suite |

The focused suites remain authoritative for authentication, staff roles, manual
King/Queen voting, Lantern voting, Memory Photo, private totals and model rules.
The general API suite deliberately does not duplicate those workflows.
