# Archive Report: Google Calendar Sync (calendar-sync)

**Change**: google-calendar-integration  
**Issue**: #78 — "Vincular sesiones/consultas con Google Calendar del terapeuta"  
**Capability**: calendar-sync  
**Archive Date**: 2026-08-26  
**Archived to**: `openspec/changes/archive/2026-08-26-google-calendar-integration/`

## Change Status at Close

**SDD Cycle Complete**: ✅  
All phases (proposal, spec, design, tasks, implementation, verification) finished; change is deployed to main.

| Artifact | Status | Observation ID | Notes |
|----------|--------|---|-------|
| Proposal | ✅ Approved | 1221 | Issue #78 scoped; Slice 3 of shared exploration; Slices 1-2 shipped as session-reminders |
| Specification | ✅ Finalized | 1223 | 7 requirements / 14 scenarios; calendar-sync capability |
| Design | ✅ Approved | 1224 | Module architecture, Prisma schema, patient-code algorithm, OAuth state JWT, event minimization |
| Tasks | ✅ All Complete | 1226 | 55/55 tasks; 8 phases across 3 chained PRs; stacked-to-main delivery strategy |
| Verify Report | ✅ PASS | 1234 | 0 CRITICAL, 0 WARNING, 3 non-blocking SUGGESTION |

## Implementation & Delivery

### Chained PR Strategy
Stacked-to-main (confirmed per design.md and tasks.md):
- **PR #92** (Phases 1–3): Schema + shared AES-GCM crypto + OAuth/token custody with signed single-use `state`
- **PR #93** (Phases 4–6): Sync propagation (create/correct/soft-delete), reconciler cron, patient-code util
- **PR #94** (Phase 7): SettingsPage frontend + RAT update

**Merge Status**: All 3 PRs merged to main  
**Final Commit**: ec033ce (merge of PR #94)  
**Branch**: main

### Build & Test Evidence (at close)
**Verdict**: PASS — 467/467 tests passing, lint clean both stacks

- Backend unit tests: 264 passing
- Backend E2E tests: 141 passing
- Frontend unit tests: 62 passing
- **Total**: 467 passed / 0 failed
- **Build**: ✅ backend `nest build` + frontend `npm run build` both succeeded
- **Lint**: 0 errors (backend + frontend)

Evidence hashes (per `verify-report` observation 1234):
- Test output: sha256:27139c429cc5b91a8e1fa453301d248bcb8cd37c5a10c584f78676041d4c53ea
- Build output: sha256:951700acf39fe948a1996bf7105c67af9ff20e93412e76a4b0d6d21b5ed48621

### Specification Compliance
All 7 requirements and 14 scenarios verified COMPLIANT via dedicated test suites and E2E coverage:

1. **OAuth Connection Lifecycle** (connect/disconnect) — calendar-oauth.service.spec.ts, calendar-integration.e2e-spec.ts ✅
2. **Encrypted Token Custody** (stored encrypted / decrypted only for use) — google-token-crypto.service.spec.ts, aes-gcm.spec.ts ✅
3. **Push-Only Propagation Keyed by groupId** (create / correct / soft-delete) — calendar-sync.service.integration.spec.ts, consultations.service.spec.ts, patients.service.spec.ts ✅
4. **Content Minimization** (minimized body / sessionType excluded) — calendar-sync.service.spec.ts:168 ✅
5. **Bounded Backfill** (within window / outside window skipped) — calendar-sync.service.integration.spec.ts:233 ✅
6. **Degraded Connection on Revoked Grant** (disconnect+notify once / no retry loop) — calendar-sync.service.spec.ts:293,316 ✅
7. **Non-Blocking Sync Failures** — consultations.service.integration.spec.ts:147,174 ✅

### Security Invariants (Confirmed)

Per design.md and verify-report (observation 1234), both mandatory security rules re-confirmed at close:

1. **Single-use, subject-bound OAuth `state` JWT**: Verified by jwt.strategy.spec.ts:74 and E2E forgery/replay tests (calendar-integration.e2e-spec.ts:189-289). An unauthenticated callback cannot mutate a connection row with a forged state.

2. **Per-therapist tenancy on GET /status and POST /disconnect**: Both endpoints query exclusively `where: { therapistId }` from `@CurrentUser()`; structurally impossible to address another therapist's row. Confirmed by E2E Tenancy block (lines 291-345).

3. **Event-body minimization traced end-to-end**: Prisma query (calendar-sync.service.ts:79-84) selects only `patient: { id, fullName, deletedAt }` — clinical fields (rut, consultReason, intervention, agreements) are never fetched for the sync path.

## Deviations from Scope (Both Disclosed, Non-Blocking)

Per final-state facts and design.md:

### Deviation 1: `googleAccountEmail` Intentionally Unpopulated
**Reason**: OAuth scope is `calendar.events` only (no `email`/`openid` scope).  
**Status**: Accepted business-rule gap, disclosed in proposal.md and design.md, not a regression.  
**Impact**: `purgeLinksOnAccountChange` is implemented and tested but not wired (no live trigger). A reconnect will accumulate event links keyed by `(connectionId, groupId)` across different email accounts on the same therapist row. This is acceptable because:
- Reconnection is a rare event (only when OAuth re-authorization is needed).
- Event links are purged only on disconnection (DELETE all `CalendarEventLink` rows for that `connectionId`).
- No clinical data loss; worst case is orphaned Google events (not deleted from Google until the link's next sync attempt fails).

### Deviation 2: `Consultation.deletedAt` Unreachable at Implementation Time
**Status**: Disclosed in design.md; no regression.  
**Details**: No `DELETE /consultations/:id` endpoint or `ConsultationsService.softDelete` method exists in the codebase today. The business rule "deletedAt set → delete the Google event" is unreachable through any API write path at close. However:
- Design covers it via the reconciler (`consultation.deletedAt` OR `patient.deletedAt`).
- The reconciler activates automatically when soft-delete is implemented later.
- `DELETE /patients/:id` IS reachable today (soft-deletes the patient without touching their consultations); the reconciler handles this correctly.

## Operational Notes (Not Code Issues)

Per final-state facts:

### PR2 GitHub Actions Infrastructure Incident (Transient)
PR #93's GitHub Actions CI run got stuck in a GitHub-side `queued` state with 0 jobs assigned for 25+ minutes. `gh run cancel` returned contradictory status vs `gh run view` — this was a GitHub infrastructure transient, not a repo/workflow defect. PR #93 was merged on local test evidence; main has no branch protection, so GitHub CI is advisory only.

**Impact**: Null. No code changes required; infrastructure issue did not affect delivered change.

## Spec Sync to Main

**Action Taken**: Delta spec `openspec/changes/google-calendar-integration/specs/calendar-sync/spec.md` copied to main spec at `openspec/specs/calendar-sync/spec.md`.

**Verification**: Empty `diff -r` confirming byte-identity between source and destination.

This is the first version of the calendar-sync capability specification; no prior main spec existed to merge into.

## Archive Contents

All change artifacts preserved at `openspec/changes/archive/2026-08-26-google-calendar-integration/`:

- ✅ proposal.md
- ✅ specs/calendar-sync/spec.md (delta spec)
- ✅ design.md
- ✅ tasks.md (55/55 tasks complete)
- ✅ verify-report.md (PASS verdict, 7/7 requirements, 14/14 scenarios)
- ✅ exploration.md (historical context)
- ✅ archive-report.md (this file)

Verified via `diff -r` snapshot comparison: empty diff confirms no truncation or alteration during mechanical archive move.

## Final Verification Checklist

- [x] Proposal approved (observation 1221)
- [x] Specification complete (observation 1223)
- [x] Design approved (observation 1224)
- [x] Tasks complete: 55/55 (observation 1226)
- [x] Verify report: PASS (observation 1234, 0 CRITICAL findings)
- [x] All 3 PRs merged to main (#92, #93, #94)
- [x] Build passing (backend + frontend)
- [x] Tests passing: 467/467
- [x] Lint passing: 0 errors both stacks
- [x] Delta spec synced to main spec
- [x] Change folder moved to archive
- [x] Archive integrity verified (empty diff from snapshot)
- [x] Main spec location: `openspec/specs/calendar-sync/spec.md`
- [x] Archive location: `openspec/changes/archive/2026-08-26-google-calendar-integration/`
- [x] SDD cycle complete; ready for next change

## Engagement Summary

**Total Phases**: 8 (schema, crypto, OAuth/tokens, sync, reconciler, patient-code, frontend, verification)  
**Chained PRs**: 3 (stacked-to-main strategy)  
**Review Workload Forecast**: High (~1300–1600 changed lines; successfully delivered in 3 focused PRs)  
**Test Coverage**: 467 tests across backend unit, backend E2E, and frontend unit  
**Security Invariants**: 2 mandatory RED E2E rules confirmed at close  
**Known Gaps**: 2 (both disclosed, non-blocking: `googleAccountEmail` unpopulated, `Consultation.deletedAt` unreachable today)  
**Non-Blocking Suggestions**: 3 (coverage re-measure, defense-in-depth query optimization, third-party console tip pre-existing)

## Traceability

All change artifacts recorded by observation ID for permanent audit trail:

- Proposal: 1221
- Specification: 1223
- Design: 1224
- Tasks: 1226
- Verify Report: 1234
- Archive Report: (this file)

Archive report persisted to Engram at `sdd/google-calendar-integration/archive-report` topic key.

---

**Archive closed**: 2026-08-26 by sdd-archive executor  
**SDD cycle status**: COMPLETE ✅
