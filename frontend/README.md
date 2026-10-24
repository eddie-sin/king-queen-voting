# Student website — manual controls version

See the [current root README](../README.md) for setup and API contracts. This branch uses email/password sign-in, one final King vote and one final Queen vote, manual event status and actual candidate totals. No voting key or date schedule is used. Memory Photo, Lanterns, wishes and music keep their existing roles.

`npm run dev` uses the configured local API proxy. `npm run dev:fixtures` provides an isolated visual preview with fake accounts/votes. `npm run build` creates the production website. Old test files still describe the previous contracts; their rewrite and correctness/capacity verification are deferred to the next phase.
