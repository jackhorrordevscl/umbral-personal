# Delta for calendar-sync

## Reconciliation note (PR 3, apply phase)

This delta originally carried a `MODIFIED Requirements` block adding OAuth
scope-broadening and a re-consent flow for `OAuth Connection Lifecycle`,
written against the *assumption* that `calendar-availability-overlay` would
need a second, read-oriented Google scope alongside `calendar.events`.

PR 0's spike (see `apply-progress.md`) and design.md Decision 1 confirmed
`events.list` returns the data the overlay needs under the **existing**
`calendar.events` scope — zero re-consent, zero scope broadening, zero new
migration. `google-calendar.client.ts#listBusyIntervals()` (PR 1) and
`calendar-busy.service.ts` (PR 2) were built and shipped entirely on that
premise: `CalendarBusyService.refresh()` iterates every `CONNECTED`
connection with no scope check, gate, or field read (see the inline code
comment at `calendar-busy.service.ts:30-36` documenting that same
deviation from tasks.md 2.1's original wording).

Given that, the `OAuth Connection Lifecycle` requirement never actually
changes for this capability: the base spec (`openspec/specs/calendar-sync/spec.md`)
already states the connection requests only `calendar.events` and that
scope is sufficient for both push sync and the new overlay read path. There
is no second scope to request, no "pre-existing vs. re-consented"
distinction to draw, and therefore no re-consent flow to build.

**Decision**: this delta carries no `MODIFIED Requirements` block. Nothing
merges into `openspec/specs/calendar-sync/spec.md` at archive time — the
base requirement stays exactly as it is today. See PR 3 in `tasks.md` and
`apply-progress.md` for the full reconciliation record, including why a
speculative "track pre-overlay vs. post-overlay connections" field was
considered and rejected (no current consumer, no current Google scope
change to observe, adds unused surface for a hypothetical future policy
change that is not in scope for this release).
