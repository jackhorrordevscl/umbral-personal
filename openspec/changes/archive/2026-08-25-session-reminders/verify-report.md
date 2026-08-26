```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:c101a566a35ec7e20446165e9c516886cfa36972181d3a3dbe213422402b98bf
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 14/14
test_command: cd backend && npx jest --coverage && npx jest --config ./test/jest-e2e.json --forceExit && cd ../frontend && npm test -- --run
test_exit_code: 0
test_output_hash: sha256:48667fa6469bc0a959a6a95253217d2a3a26181156ed0c307acf9fd047e9793e
build_command: cd backend && npx nest build && cd ../frontend && npm run build
build_exit_code: 0
build_output_hash: sha256:f1df75588099a6a8e49bc5b1273a8eb6b0885c8323930deedc987aa297084528
```

## Verification Report

**Change**: session-reminders
**Version**: N/A (no baseline; first specs for `session-reminders` and `in-app-notifications`)
**Mode**: Standard (non-TDD-gated verify; PR1/PR2/PR3 authored under RED/GREEN convention, confirmed below)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 40 |
| Tasks complete | 40 |
| Tasks incomplete | 0 |

All 3 PRs (Notifications #84, Reminders engine #85, Frontend #89) merged to main at HEAD f4c82e1.

### Build & Tests Execution

**Build**: PASSED
```text
cd backend && npx nest build          exit 0
cd frontend && npm run build          tsc -b && vite build, exit 0
```

**Tests**: 192 backend unit + 131 backend e2e + 56 frontend unit = 379 passed / 0 failed
```text
backend unit  (npx jest --coverage):                 22 suites, 192 tests passed
backend e2e   (npx jest --config jest-e2e.json):      16 suites, 131 tests passed
frontend unit (npm test -- --run):                    10 files, 56 tests passed
```
Note: an earlier full-e2e run on this local Windows machine intermittently failed 3 unrelated suites
(documents, mfa-recover/rbac-ownership/patient-consent, rotating between runs) with
"Exceeded timeout of 5000 ms for a hook" on beforeAll module compilation, never the same suites twice,
and always passing standalone. notifications.e2e-spec.ts (the suite covering this change's tenancy/route-order
requirements) passed in every run. Re-run captured for this report was clean (131/131). Logged as WARNING below,
not a blocker.

**Coverage**: reminders module 84.7% stmts / 73.17% branch / 92.85% funcs. Threshold: not configured project-wide.

### Spec Compliance Matrix

**Spec: session-reminders**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Two-Offset Detection Window | 24h offset becomes due | reminders.util.spec.ts (H24 boundary); reminders.service.spec.ts (dispatch on both channels) | COMPLIANT |
| Two-Offset Detection Window | 2h offset becomes due independently | reminders.util.spec.ts (H2 boundary); unique key (groupId, sessionDate, offsetKind, channel) differentiates H24/H2 rows | COMPLIANT |
| Exactly-Once Delivery Per (Consultation, Offset, Channel) | Re-running the scan does not duplicate | reminders.service.spec.ts (P2002 skip, no re-send); reminders.service.integration.spec.ts (two consecutive real scans, one dispatch per tuple) | COMPLIANT |
| Late-Created Session Fires Immediately | Session created inside only the 24h window | reminders.util.spec.ts (only H24 due when 2h < remaining < 24h) | COMPLIANT |
| Late-Created Session Fires Immediately | Session created inside both windows (nearest-only, other SKIPPED) | reminders.util.spec.ts + reminders.service.spec.ts (only H2 dispatches, H24 recorded SKIPPED) | COMPLIANT |
| Reschedule Re-Arms All Offsets | Rescheduled session resends both offsets | reminders.service.spec.ts (correct() moves sessionDate: 4 new dispatch rows) | COMPLIANT |
| Soft-Deleted Consultations Are Excluded | Deleted session is never reminded | reminders.service.spec.ts (query WHERE assertion); reminders.service.integration.spec.ts (real Postgres WHERE excludes deletedAt/correctedBy) | COMPLIANT |
| Email Channel Degrades Gracefully | Missing API key still yields an in-app notification | reminders.service.spec.ts (null-client MailService); mail.service.spec.ts | COMPLIANT |
| Channels Dispatch Independently | Email send throws | reminders.service.spec.ts (email rejects, in-app notification still created exactly once) | COMPLIANT |

**Spec: in-app-notifications**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Therapist-Scoped Persistence | Notification created for the owning therapist | notifications.service.spec.ts (create scoped by userId); exercised end-to-end by reminders.service.spec.ts | COMPLIANT |
| Authorized, Owner-Scoped Retrieval | Therapist B cannot see therapist A's notifications | notifications.e2e-spec.ts (list + unread-count isolation) | COMPLIANT |
| Authorized, Owner-Scoped Retrieval | Unauthenticated request is rejected | notifications.e2e-spec.ts (401 on list and unread-count without token) | COMPLIANT |
| Read/Unread Lifecycle Scoped to Owner | Owner marks a notification read | notifications.e2e-spec.ts (owner mark-read succeeds); notifications.service.spec.ts | COMPLIANT |
| Read/Unread Lifecycle Scoped to Owner | Non-owner cannot mark it read | notifications.e2e-spec.ts (non-owner mark-read returns 404, notification unchanged) | COMPLIANT |

**Compliance summary**: 14/14 scenarios compliant, 10/10 requirements compliant.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| Due-ness instant predicate (sessionDate - offsetMs <= now) | Implemented | reminders.util.ts resolveDueOffsets, pure function; table-driven tests incl. exact-boundary and DST-crossing (2026-04-04 Chile DST rollback) cases |
| Claim-then-send via @@unique (P2002) | Implemented | reminders.service.ts claimAndDispatch/claimSkipped; isUniqueConstraintError duck-typed like EmailChangeService precedent; verified against real Postgres constraint in integration spec |
| Nearest-offset-only + SKIPPED audit trail | Implemented | resolveDueOffsets returns dispatch/skipped; SKIPPED rows still occupy the unique key (claimSkipped), preventing later re-fire |
| Re-arm via (groupId, sessionDate, offsetKind, channel) key | Implemented | consultations.service.ts correct() creates new row sharing groupId, new sessionDate means new key automatically; text-only correction (same sessionDate) reuses key, confirmed silent via P2002 mock |
| Soft-delete / superseded exclusion | Implemented | scan() WHERE deletedAt: null, correctedBy: null, same pattern as consultations.service.ts; confirmed against real Postgres in integration spec |
| Email failure never blocks in-app | Implemented | Each channel gets its own claimAndDispatch call / own ReminderDispatch row; mailService.sendSessionReminderEmail failure only marks the EMAIL row FAILED, IN_APP row unaffected |
| MailService degrades on missing RESEND_API_KEY | Implemented | mail.service.ts sendSessionReminderEmail returns early with a logged warning, never throws |
| reminderSent fully removed | Implemented | Absent from schema.prisma Consultation model, migration 20260825180000_session_reminders drops the column, no remaining references in .ts source (grep confirms zero hits outside migration SQL) |
| Owner-scoped notification mutation | Implemented | notifications.service.ts markRead uses updateMany({id, userId}), 0 rows returns uniform 404 (same non-disclosure pattern as PatientsService) |
| Route order (unread-count before :id) | Implemented | notifications.controller.ts declares GET unread-count before PATCH :id/read; confirmed by dedicated e2e assertion |
| REMINDERS_ENABLED validation + default | Implemented | env.validation.ts restricts to true/false/undefined; reminders.service.ts constructor treats anything but literal "false" as enabled |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Dispatch-log table keyed on (groupId, sessionDate, offsetKind, channel) | Yes | Exact key implemented, @@unique present in schema |
| Unique constraint as race-safe at-most-once guarantee | Yes | Claim-then-send with P2002 catch, no advisory locks introduced |
| Due-ness as instant predicate, not time band | Yes | resolveDueOffsets matches design pseudocode exactly |
| Nearest-offset-only on simultaneous due | Yes | Matches design's worked example (session created 10 min out, only H2 fires, H24 SKIPPED) |
| UTC instant arithmetic; explicit render zone | Yes | mail.service.ts uses Intl.DateTimeFormat es-CL / America/Santiago only for rendering; due-ness math is pure Date.getTime() |
| No ConsultationsService hook (poller discovers via query) | Yes | consultations.service.ts untouched except reminderSent line removal; no event emitter, no circular import |
| Notification channel-generic (no consultationId FK) | Yes | Schema matches design's Notification model verbatim (type/title/body/linkPath/metadata) |
| REST contract (GET /notifications, /unread-count, PATCH :id/read, PATCH read-all) | Yes | Controller matches design's table exactly, including route-order note |
| REMINDERS_ENABLED=false must be set in the e2e environment | Deviation | Not set in .env, .github/workflows/ci.yml, or any e2e config, see WARNING below |
| Frontend polling interval / UI shape | N/A (design left open) | Frontend author documented 30s interval and dropdown/bell split as their own decision, consistent with design's REST-contract-only scoping |

### Issues Found

**CRITICAL**: None.

**WARNING**:
1. REMINDERS_ENABLED=false is not set anywhere in the e2e/CI environment (backend/.env, backend/.env.example, .github/workflows/ci.yml), contradicting design.md's explicit "Migration / Rollout" instruction that it must be set in the e2e environment so AppModule boot never fires reminders. Today this is benign: the cron (EVERY_5_MINUTES) is active during e2e/CI runs, but existing e2e fixtures use sessionDate values far in the past (e.g. 2026-01-01) relative to the current test-run date, so scan() finds nothing in its (now, now+24h] window and no notification/email pollution occurs. It becomes a real risk if a future e2e/CI fixture creates a consultation with a near-future sessionDate, or if a CI job ever runs long enough (over 5 min) for the cron to tick mid-suite: it would create real Notification/ReminderDispatch rows as a side effect of unrelated tests. Recommend setting REMINDERS_ENABLED=false in backend/.env (local) and in the ci.yml env block for the backend job, per design.md's own instruction.
2. Local Windows dev-machine e2e runs showed non-deterministic beforeAll timeouts (Exceeded timeout of 5000ms) across unrelated pre-existing suites (documents, mfa-recover, rbac-ownership, patient-consent, rotating, never the same set twice across 3 runs) when running the full 16-suite e2e sequence, most likely local Postgres connection/ts-jest cold-compile contention rather than a code defect: every suite passes standalone, and the suite covering this change's own requirements (notifications.e2e-spec.ts) passed in all 3 runs. A clean full run (131/131) was captured for this report's evidence hash. Not attributed to session-reminders code; flagged for maintainer awareness given the new module increases AppModule's bootstrap surface slightly.

**SUGGESTION**:
1. reminders.module.ts and the REMINDER_OFFSETS constant show 0% or partial statement coverage in the Jest coverage summary (trivial DI wiring / already-covered-indirectly constant); no action needed, noted only for completeness since the coverage table was inspected.

### Verdict

PASS WITH WARNINGS
All 40 tasks complete, all 10 spec requirements / 14 scenarios have passing runtime evidence (backend unit 192, backend e2e 131, frontend unit 56, all green against real Postgres for integration/e2e), design decisions faithfully implemented, and all 7 proposal success criteria satisfied; two WARNINGs (missing REMINDERS_ENABLED=false in e2e/CI per design.md, and unrelated local e2e flakiness) do not block correctness and are recommended follow-ups, not blockers to archive.
