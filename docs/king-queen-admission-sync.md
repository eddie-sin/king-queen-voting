# King and Queen voting admission synchronization

The student page reads shared database controls, while King/Queen submissions also pass through a bounded in-process admission queue. Previously that queue was opened only by a control command received by the same backend process. A second backend sharing the database could open the published voting window without opening the production process's queue. The page showed open, but submissions returned `Voting is closed. Your vote was not started.` Lantern voting does not use that queue.

Before admitting a King/Queen submission, reconcile the local gate with the current shared controls. Keep a round/window hold when local closing has begun so a still-open database snapshot cannot undo close/drain. Ignore older control revisions to avoid out-of-order reads closing a newer window. Existing transactional validation, immutable per-category ballots, uniqueness, queue bounds, and stale round/window protection remain authoritative.

The confirmation dialog no longer displays an account/control-change warning during normal in-flight recording and choice refresh.

Regression coverage includes a real browser against disposable API/database data: opening through shared controls rather than the local admin endpoint, King and Queen submission, a confirmation wait longer than fifteen seconds, and persistence after reload. Admission tests cover local close/drain, external closure, reopening a new window and out-of-order snapshots. These checks are included in the normal authentication/browser CI suite. No production account, email or ballot is used by tests.
