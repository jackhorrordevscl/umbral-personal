```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:a4b48af3bd023086d41e4c28934bb7d020a56021fbbd43e8cf48b665f8a02348
verdict: fail
blockers: 2
critical_findings: 2
requirements: 8/10
scenarios: 22/23
test_command: cd backend && npm test && cd ../frontend && npm test
test_exit_code: 0
test_output_hash: sha256:e06ce2962c834b3db17ad3193643ba19a08fa1a2fa06f83398c695d9d9829fae
build_command: cd backend && npx tsc --noEmit -p tsconfig.json
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: public-booking-payment-calendar
**Version**: N/A (unarchived change; 5 capability deltas, 1 new, 4 modified)
**Mode**: Strict TDD (backend/frontend), full spec-driven verification

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 31 (PR0: 3, PR1: 5, PR2: 5, PR3: 4, PR4: 4, PR5a/5b: 6, PR6: 4) |
| Tasks complete | 31 |
| Tasks incomplete | 0 |

All 31 tasks in tasks.md are checked complete. PR 0's spike result is now internally consistent: tasks.md shows 0.1/0.2/0.3 as complete with "DONE, result: HTTP 200" recorded inline, matching apply-progress.md's Resolution section (real result, run by the user locally on 2026-09-11) - no contradiction between the checkboxes and the narrated outcome. PR 3 is marked complete as a documented no-op (reconciliation), not as shipped code - verified below.

### Build & Tests Execution

**Build**: PASSED
```text
cd backend && npx tsc --noEmit -p tsconfig.json    exit 0, no output
cd frontend && npx tsc --noEmit -p tsconfig.app.json  exit 0, no output
```

**Tests**: 735 passed / 0 failed / 0 skipped
```text
backend  npm test (Jest, unit)                              52 suites / 605 tests passed
backend  npx jest --config ./test/jest-e2e.json --forceExit
         calendar-busy-overlay public-booking-checkout        2 suites / 5 tests passed
frontend npm test (vitest run)                              21 files / 125 tests passed
```
Total 605 + 5 + 125 = 735 tests, 0 failures, run directly by this verify session (not taken from prior batch reports).

**Coverage**: Not available (no coverage command configured for either package)

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| calendar-availability-overlay: Periodic Free-Busy Cache Ingestion | Job refreshes the overlay for connected therapists | calendar-busy.service.spec.ts (successful refresh) | COMPLIANT |
| calendar-availability-overlay: Periodic Free-Busy Cache Ingestion | Job skips therapists without the read scope | none, behavior deliberately not implemented | FAILING, see CRITICAL-1 |
| calendar-availability-overlay: Overlay Consumption in Slot Computation | Cached busy block excludes an otherwise free slot | availability.service.spec.ts (fresh overlay merges), calendar-busy-overlay.e2e-spec.ts | COMPLIANT |
| calendar-availability-overlay: Overlay Consumption in Slot Computation | Slot computation latency is unaffected | availability.service.spec.ts (flag-off zero-query), e2e byte-identical test | COMPLIANT |
| calendar-availability-overlay: Stale Cache Degrades to No Overlay Exclusion | Stale cache falls back to pre-overlay behavior | availability.service.spec.ts (stale busySyncedAt) | COMPLIANT |
| calendar-availability-overlay: Stale Cache Degrades to No Overlay Exclusion | Missing cache does not error | availability.service.spec.ts (missing connection) | COMPLIANT |
| calendar-availability-overlay: Independent Feature Flag | Flag off disables ingestion and consumption | calendar-busy.service.spec.ts (flag off), availability.service.spec.ts (flag off) | PARTIAL, see CRITICAL-2 |
| calendar-availability-overlay: Booking-Time Recheck Independent of Overlay Freshness | Overlay staleness does not weaken write-time protection | pre-existing BookedSlot unique-index / recheck tests, no call-site change per design.md Decision 4 | COMPLIANT |
| calendar-sync: delta carries no MODIFIED block, reconciled no-op | N/A | N/A | N/A, 0 requirements merge from this delta |
| payments: Checkout URL Exposure to the Booking Response | Booking response carries the checkout URL when already available | public-scheduling.service.spec.ts checkout tests | COMPLIANT |
| payments: Checkout URL Exposure to the Booking Response | Booking response omits the checkout URL without failing | public-scheduling.service.spec.ts NOT_APPLICABLE cases | COMPLIANT |
| payments: Flow Return Endpoint | Flow POST return redirects to the confirmation page | payments.service.spec.ts resolveReturnRedirectUrl, pre-existing, zero-diff per PR 4.2 | COMPLIANT |
| payments: Flow Return Endpoint | Arrival at the return endpoint does not change payment state | payments.service.spec.ts resolveReturnRedirectUrl, pre-existing | COMPLIANT |
| public-scheduling: Public Booking Write Endpoint | Booking a currently free slot succeeds | pre-existing public-scheduling.service.spec.ts / e2e | COMPLIANT |
| public-scheduling: Public Booking Write Endpoint | Booking a slot outside the booking window fails | pre-existing tests | COMPLIANT |
| public-scheduling: Public Booking Write Endpoint | Booking succeeds and carries a checkout URL when available | public-booking-checkout.e2e-spec.ts tests 1 and 3 | COMPLIANT |
| public-scheduling: Public Booking Write Endpoint | Booking succeeds without a checkout URL when payment is unavailable | public-booking-checkout.e2e-spec.ts test 1, no PaymentAccount/GoogleCalendarConnection seeded | COMPLIANT |
| public-scheduling: Booking Confirmation Surfaces the Checkout Link In-Page | Confirmation page shows the in-page checkout link | PublicBookingPage.spec.tsx checkout PENDING to CTA | COMPLIANT |
| public-scheduling: Booking Confirmation Surfaces the Checkout Link In-Page | Confirmation page shows no checkout link when unavailable | PublicBookingPage.spec.tsx NOT_APPLICABLE / absent, no polling | COMPLIANT |
| public-scheduling: Booking Confirmation Surfaces the Checkout Link In-Page | Flow return arrival displays confirmation state, not payment status | PublicBookingPage.spec.tsx flow_return=1, defensive confirmation | COMPLIANT |
| therapist-availability: Query-Time Slot Computation with Bounded Cache | Existing consultation removes its slot | pre-existing availability.service.spec.ts | COMPLIANT |
| therapist-availability: Query-Time Slot Computation with Bounded Cache | Repeated query within cache window reuses computed result | pre-existing cache tests | COMPLIANT |
| therapist-availability: Query-Time Slot Computation with Bounded Cache | Overlay-covered busy time is excluded when the capability is enabled | availability.service.spec.ts fresh overlay merges | COMPLIANT |
| therapist-availability: Query-Time Slot Computation with Bounded Cache | Slot computation is unaffected when the overlay capability is disabled | availability.service.spec.ts flag-off, e2e byte-identical test | COMPLIANT |

**Compliance summary**: 22/23 scenarios compliant (1 FAILING, 1 PARTIAL noted at the requirement level above)

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| PR0 spike documentation consistency | Implemented | tasks.md and apply-progress.md agree: HTTP 200, run by the user locally, script deleted, never committed |
| PR3 no-op reconciliation for the calendar-sync delta | Implemented | specs/calendar-sync/spec.md carries no MODIFIED Requirements block; openspec/specs/calendar-sync/spec.md's existing calendar.events-only requirement is untouched and stays correct at archive |
| defaultSessionAmount known-issue documented in code | Implemented | public-scheduling.service.ts lines 180-186, comment block directly above resolveCheckoutHint()'s amount-unresolvable branch, explicitly labeled known-issue with a reference to design.md Open Questions and tasks.md 6.4, not a silent gap |
| Both feature flags documented in README.md | Implemented | README.md lines 888-889, env-var reference table rows for both flags, plus a dedicated sub-section under Auto-agenda publica de pacientes |
| computeAvailableSlots() untouched | Implemented | git show of the PR2 commit (23f0e73) has zero diff lines touching computeAvailableSlots in availability.service.ts; the overlay merges into the pre-existing blockouts array only, exactly as design.md Decision 3 mandates |
| calendar-availability-overlay spec.md reconciled against Decision 1 | Not implemented | See CRITICAL-1 and CRITICAL-2 below, the delta text was never rewritten, unlike the sibling calendar-sync delta |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Decision 1: events.list under existing scope, no OAuth migration | Yes in code | Confirmed in google-calendar.client.ts listBusyIntervals() and calendar-busy.service.ts, no scope parameter, no scope check; PR 0 spike (HTTP 200) backs it. But the calendar-availability-overlay capability spec was never updated to match, see Issues |
| Decision 2: reuse existing Flow return endpoint unchanged | Yes | PR 4.2 verified zero-diff; PaymentsController.returnFromGatewayPost/Get untouched |
| Decision 3: Postgres table CalendarBusyBlock, not Redis/in-memory | Yes | Migration and model confirmed in PR 1; invalidate() called on refresh |
| Decision 4: booking recheck consults overlay cache, never Google live | Yes | No call-site change in PublicSchedulingService.book()'s recheck; overlay flows through the same blockouts merge |
| Decision 5: checkout is polled, not awaited | Yes | ensureCharge() stays fire-and-forget; CHECKOUT_POLL_INTERVAL_MS and CHECKOUT_POLL_TIMEOUT_MS poll implemented in PublicBookingPage.tsx |

### Issues Found

**CRITICAL**:

1. specs/calendar-availability-overlay/spec.md was never reconciled against design.md Decision 1, unlike calendar-sync's delta. The requirement "Periodic Free-Busy Cache Ingestion" still states the job runs for each therapist with an active, re-consented Google connection, and its scenario "Job skips therapists without the read scope" describes a skip-by-scope mechanism that was deliberately never built (calendar-busy.service.ts lines 30-36 document the omission in an inline comment: the job iterates every CONNECTED connection unconditionally, with zero scope check). There is no test for the skip behavior because the behavior does not exist, and no test could pass one, because the code path was intentionally not written. This is the same underlying finding that PR 3 correctly reconciled into specs/calendar-sync/spec.md (which now carries no MODIFIED Requirements block), but the new capability's own spec (calendar-availability-overlay) was left as originally drafted before PR 0's spike ran. Left as-is, this delta merges unmodified into openspec/specs/calendar-availability-overlay/spec.md at archive time, permanently enshrining a requirement and scenario that contradict the shipped, tested implementation.

2. Same file, requirement "Independent Feature Flag": the normative text says the flag follows the existing X_ENABLED not-equal-to-false convention, but the shipped implementation is deliberately opt-in, equal-to-true (calendar-busy.service.ts lines 55-62, availability.service.ts lines 222-224), per design.md's explicit Migration/Rollout section and confirmed by tasks.md 2.2's own documented spec-vs-design.md discrepancy resolution. The literal scenario given, "Flag off disables ingestion and consumption", which explicitly sets the flag to false, still passes under either convention, so it is marked PARTIAL rather than FAILING, but the requirement's own MUST text is factually wrong about the flag's default-off/opt-in behavior and was never corrected, the same reconciliation gap as CRITICAL-1.

**WARNING**:

1. calendar-availability-overlay spec.md's requirement text says the job queries Google's free-busy API. The shipped implementation queries events.list (the Calendar Events API), not a freebusy.query-style endpoint, per design.md Decision 1's explicit rejection of freebusy.query. Functionally equivalent since both produce busy intervals, but the wording invites the same kind of confusion CRITICAL-1/2 already demonstrate, coming from unreconciled delta text.

2. No coverage-threshold command is configured for either package, so the Coverage evidence field in this report is Not available rather than a measured percentage. Not a defect in this change, but worth a project-level follow-up if a coverage gate is ever desired.

**SUGGESTION**:

1. Every PR's actual authored diff exceeded its own tasks.md line forecast (PR1 about 435 vs about 180-220, PR2 about 830 vs about 220-260, PR5a about 499 as part of about 260-320). Each was individually justified and documented as a size exception with real reasoning (Strict-TDD test density, Spanish comment-density convention), not gamed. Future sdd-tasks forecasts for Strict-TDD-mode payment/calendar-adjacent PRs in this codebase should budget noticeably higher than the historical 180-320 line range to reduce the number of size-exception write-ups needed.

### Verdict
FAIL

2 CRITICAL findings: specs/calendar-availability-overlay/spec.md, the new capability's own delta, was never reconciled against design.md Decision 1 and the actually-shipped, tested implementation, unlike the sibling calendar-sync delta, which was correctly reconciled in PR 3. All code, tests (735/735 passing across backend unit/e2e and frontend), and the other 4 capability deltas are sound; this is a documentation/spec-merge blocker, not a runtime defect, and is fixable with a text-only edit to one spec file before archive.
