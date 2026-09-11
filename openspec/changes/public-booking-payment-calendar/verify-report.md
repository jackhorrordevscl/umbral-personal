```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:d2d132fe7541c8607c6a0fabe37eecf05d4d49e21adf89d9740280822401cf79
verdict: pass
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 22/22
test_command: cd backend && npm test && npx jest --config ./test/jest-e2e.json calendar-busy-overlay public-booking-checkout --forceExit && cd ../frontend && npm test
test_exit_code: 0
test_output_hash: sha256:7db74c8c58103feecd6964611eb3417273345a9651e5310a5e9173d1c1784597
build_command: cd backend && npx tsc --noEmit -p tsconfig.json && cd ../frontend && npx tsc --noEmit -p tsconfig.app.json
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: public-booking-payment-calendar
**Version**: N/A (unarchived change; 5 capability deltas, 1 new, 4 modified)
**Mode**: Strict TDD (backend/frontend), full spec-driven verification -- RE-VERIFY after commit b74078b (documentation-only fix, no code/test changes)

### Re-Verification Context

The prior verify session (evidence_revision sha256:a4b48af3..., full report at Engram sdd/public-booking-payment-calendar/verify-report and this same file's prior revision) returned FAIL with 2 CRITICAL, 2 WARNING, 1 SUGGESTION. Both CRITICAL findings targeted specs/calendar-availability-overlay/spec.md being unreconciled against design.md Decision 1 and the shipped implementation. Commit b74078b (fix(sdd): reconciliar specs/calendar-availability-overlay contra el hallazgo del spike) is a documentation-only fix confirmed by git show --stat: only specs/calendar-availability-overlay/spec.md (16 lines changed) and the prior verify-report.md (new file) were touched -- zero production code or test files in the diff.

### Disposition of Prior Findings

| # | Prior finding | Disposition |
|---|----------------|-------------|
| CRITICAL-1 | "Periodic Free-Busy Cache Ingestion" required a re-consented connection and a "Job skips therapists without the read scope" scenario that was deliberately never built | RESOLVED. Requirement text now reads: queries Google's events.list API (under the therapist's existing calendar.events OAuth scope -- see design.md Decision 1; a dedicated read spike proved no scope broadening or re-consent is required) for each therapist with an active (CONNECTED) Google connection. The scope-skip scenario was removed entirely (confirmed via git show b74078b diff, -11 lines removing the scenario block). Requirement now matches calendar-busy.service.ts's actual unconditional-iteration behavior. |
| CRITICAL-2 | "Independent Feature Flag" required the X_ENABLED not-equal-to-false convention, contradicting the shipped equal-to-true opt-in behavior | RESOLVED. Requirement text now describes the flag as opt-in, equal to the literal string true, not the not-equal-to-false convention used by other flags in this project -- deliberate per design.md. The scenario condition changed from an explicit false value to "unset or not exactly the string true", matching calendar-busy.service.ts lines 55-62 and availability.service.ts lines 222-224 exactly. |
| WARNING-1 | Requirement text said the job queries Google's free-busy API instead of naming events.list | RESOLVED as a side effect of the same edit. The rewritten requirement text (see CRITICAL-1 disposition) now names events.list directly, matching design.md Decision 1's explicit rejection of freebusy.query. |
| WARNING-2 | No coverage-threshold command configured for either package | STILL VALID, non-blocking. Unrelated to the fix; project-level tooling gap, not a defect in this change. Coverage evidence remains "Not available" in this report. |
| SUGGESTION-1 | Every PR's authored diff exceeded its tasks.md line forecast | STILL VALID as a retrospective note, non-blocking. Historical/process observation about sdd-tasks forecasting for this codebase; does not affect the current candidate's correctness and carries no action for archive. |

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 31 (PR0: 3, PR1: 5, PR2: 5, PR3: 4, PR4: 4, PR5a/5b: 6, PR6: 4) |
| Tasks complete | 31 |
| Tasks incomplete | 0 |

Unchanged from the prior verify session -- no task-file edits occurred in commit b74078b.

### Build & Tests Execution

**Build**: PASSED
```text
cd backend && npx tsc --noEmit -p tsconfig.json        exit 0, no output
cd frontend && npx tsc --noEmit -p tsconfig.app.json    exit 0, no output
```

**Tests**: 735 passed / 0 failed / 0 skipped -- re-run in full for this re-verify, byte-identical counts to the prior session
```text
backend  npm test (Jest, unit)                                          52 suites / 605 tests passed
backend  npx jest --config ./test/jest-e2e.json calendar-busy-overlay
         public-booking-checkout --forceExit                            2 suites / 5 tests passed
frontend npm test (vitest run)                                          21 files / 125 tests passed
```
Total 605 + 5 + 125 = 735 tests, 0 failures. Confirms the documentation-only spec fix did not touch any test-bearing file or runtime behavior.

**Coverage**: Not available (no coverage command configured for either package -- WARNING-2, unchanged)

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| calendar-availability-overlay: Periodic Free-Busy Cache Ingestion | Job refreshes the overlay for connected therapists | calendar-busy.service.spec.ts (successful refresh) | COMPLIANT |
| calendar-availability-overlay: Overlay Consumption in Slot Computation | Cached busy block excludes an otherwise free slot | availability.service.spec.ts (fresh overlay merges), calendar-busy-overlay.e2e-spec.ts | COMPLIANT |
| calendar-availability-overlay: Overlay Consumption in Slot Computation | Slot computation latency is unaffected | availability.service.spec.ts (flag-off zero-query), e2e byte-identical test | COMPLIANT |
| calendar-availability-overlay: Stale Cache Degrades to No Overlay Exclusion | Stale cache falls back to pre-overlay behavior | availability.service.spec.ts (stale busySyncedAt) | COMPLIANT |
| calendar-availability-overlay: Stale Cache Degrades to No Overlay Exclusion | Missing cache does not error | availability.service.spec.ts (missing connection) | COMPLIANT |
| calendar-availability-overlay: Independent Feature Flag | Flag off or absent disables ingestion and consumption | calendar-busy.service.spec.ts (flag off), availability.service.spec.ts (flag off) | COMPLIANT |
| calendar-availability-overlay: Booking-Time Recheck Independent of Overlay Freshness | Overlay staleness does not weaken write-time protection | pre-existing BookedSlot unique-index / recheck tests, no call-site change per design.md Decision 4 | COMPLIANT |
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

Note: calendar-sync's delta carries no Requirement headings (reconciled to a no-op in PR 3, see tasks.md) and contributes 0 to the 10/22 requirement/scenario totals; openspec/specs/calendar-sync/spec.md's existing base requirement is untouched by this change.

**Compliance summary**: 22/22 scenarios compliant, 10/10 requirements compliant -- no FAILING, no PARTIAL, no UNTESTED.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| PR0 spike documentation consistency | Implemented | tasks.md and apply-progress.md agree: HTTP 200, run by the user locally, script deleted, never committed |
| PR3 no-op reconciliation for the calendar-sync delta | Implemented | specs/calendar-sync/spec.md carries no MODIFIED Requirements block; openspec/specs/calendar-sync/spec.md's existing calendar.events-only requirement is untouched and stays correct at archive |
| defaultSessionAmount known-issue documented in code | Implemented | public-scheduling.service.ts lines 180-186, comment block directly above resolveCheckoutHint()'s amount-unresolvable branch, explicitly labeled known-issue with a reference to design.md Open Questions and tasks.md 6.4, not a silent gap |
| Both feature flags documented in README.md | Implemented | README.md env-var reference table rows for both flags, plus a dedicated sub-section under Auto-agenda publica de pacientes |
| computeAvailableSlots() untouched | Implemented | git show of the PR2 commit (23f0e73) has zero diff lines touching computeAvailableSlots in availability.service.ts; the overlay merges into the pre-existing blockouts array only, exactly as design.md Decision 3 mandates |
| calendar-availability-overlay spec.md reconciled against Decision 1 | Implemented | RESOLVED in commit b74078b (see Disposition table above): re-consent language and the unimplemented scope-skip scenario removed; flag convention corrected to the equal-to-true opt-in behavior; events.list named explicitly |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Decision 1: events.list under existing scope, no OAuth migration | Yes, in code and now in spec | Confirmed in google-calendar.client.ts listBusyIntervals() and calendar-busy.service.ts, no scope parameter, no scope check; PR 0 spike (HTTP 200) backs it. The calendar-availability-overlay capability spec is now reconciled to match (commit b74078b) -- no remaining gap. |
| Decision 2: reuse existing Flow return endpoint unchanged | Yes | PR 4.2 verified zero-diff; PaymentsController.returnFromGatewayPost/Get untouched |
| Decision 3: Postgres table CalendarBusyBlock, not Redis/in-memory | Yes | Migration and model confirmed in PR 1; invalidate() called on refresh |
| Decision 4: booking recheck consults overlay cache, never Google live | Yes | No call-site change in PublicSchedulingService.book()'s recheck; overlay flows through the same blockouts merge |
| Decision 5: checkout is polled, not awaited | Yes | ensureCharge() stays fire-and-forget; CHECKOUT_POLL_INTERVAL_MS and CHECKOUT_POLL_TIMEOUT_MS poll implemented in PublicBookingPage.tsx |

### Issues Found

**CRITICAL**: None

**WARNING**:

1. No coverage-threshold command is configured for either package, so the Coverage evidence field in this report is Not available rather than a measured percentage. Not a defect in this change, carried over unchanged from the prior verify session; worth a project-level follow-up if a coverage gate is ever desired.

**SUGGESTION**:

1. Every PR's actual authored diff exceeded its own tasks.md line forecast (PR1 about 435 vs about 180-220, PR2 about 830 vs about 220-260, PR5a about 499 as part of about 260-320). Each was individually justified and documented as a size exception with real reasoning (Strict-TDD test density, Spanish comment-density convention), not gamed. Future sdd-tasks forecasts for Strict-TDD-mode payment/calendar-adjacent PRs in this codebase should budget noticeably higher than the historical 180-320 line range to reduce the number of size-exception write-ups needed.

### Verdict
PASS

0 CRITICAL, 1 WARNING (non-blocking, pre-existing tooling gap), 1 SUGGESTION (non-blocking, process note). Commit b74078b fully resolved both CRITICAL findings from the prior verify session by reconciling specs/calendar-availability-overlay/spec.md against design.md Decision 1 and the shipped implementation: the re-consent/scope-skip language and the unimplemented scenario were removed, and the flag convention was corrected to the actual equal-to-true opt-in behavior. As a side effect, the previously separate WARNING about "free-busy API" wording was also resolved by the same edit. All 735 tests (605 backend unit + 5 backend e2e + 125 frontend) pass, both tsc --noEmit builds are clean, and the spec compliance matrix is now 22/22 scenarios and 10/10 requirements fully COMPLIANT with zero FAILING/PARTIAL/UNTESTED entries. This change is ready to proceed to sdd-archive.
