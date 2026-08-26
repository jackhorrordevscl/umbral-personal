# Archive Report: session-reminders

**Change**: session-reminders  
**Archived to**: `openspec/changes/archive/2026-08-25-session-reminders/`  
**Archive Date**: 2026-08-25  
**SDD Cycle Status**: COMPLETE  

## Executive Summary

Session reminders (therapist in-app + email) has been fully implemented, verified, and archived. All 40 tasks are complete, 4 PRs have been merged to main, and the verification report is PASS WITH WARNINGS (no critical blockers). Delta specs have been synced to the main spec repository under `openspec/specs/reminders/` and `openspec/specs/notifications/`.

## Change Overview

**Intent**: Detect upcoming therapy sessions and dispatch two-offset, two-channel reminders (email + in-app notification) to therapists. Slice 1 of 3 (google-calendar-integration family); no new external data flows.

**Scope**:
- Scheduled job (5-min cron) detecting sessions 24h and 2h ahead
- Therapist email reminders via Resend (Spanish HTML)
- Therapist in-app notifications with read/unread lifecycle
- Dispatch-log table replacing dead `Consultation.reminderSent` boolean
- New `@nestjs/schedule` infrastructure

**Out of Scope**: Patient notifications, Google Calendar sync, configurable offsets, BullMQ/Redis.

## Artifact Status

| Artifact | Status |
|----------|--------|
| proposal.md | ✅ Archived |
| spec.md | ✅ Archived; specs synced to `openspec/specs/reminders/spec.md` and `openspec/specs/notifications/spec.md` |
| design.md | ✅ Archived |
| tasks.md | ✅ Archived; 40/40 tasks complete |
| verify-report.md | ✅ Archived; PASS WITH WARNINGS |

## Specs Synced

Two new capability specs have been extracted from the combined change spec and synced to the main spec repository:

| Domain | Action | Requirements | Scenarios |
|--------|--------|--------------|-----------|
| reminders | Created | 6 req (Two-Offset Detection, Exactly-Once Delivery, Late-Created Session, Reschedule Re-Arms, Soft-Delete Exclusion, Email Degradation) | 9 scenarios |
| notifications | Created | 3 req (Therapist-Scoped Persistence, Authorized Retrieval, Read/Unread Lifecycle) | 5 scenarios |

**Spec files**:
- `openspec/specs/reminders/spec.md` (91 lines)
- `openspec/specs/notifications/spec.md` (49 lines)

## Implementation Summary

**PRs Merged to main**:
1. PR #84 (Notifications module): foundation — Notification model, service, controller, owner-scoped CRUD
2. PR #85 (Reminders cron engine): detection, dispatch, retry logic, schema changes, mail integration
3. PR #89 (Frontend notification surface): bell badge, notification list, read state management
4. PR #90 (CI fix): corrected missing `REMINDERS_ENABLED` gate per verify-report warning

**Test Results** (per verify-report):
- Backend unit: 192 tests passed (22 suites)
- Backend e2e: 131 tests passed (16 suites)
- Frontend unit: 56 tests passed (10 files)
- Build: ✅ Backend and frontend both successful
- Coverage: reminders module 84.7% statements

**Spec Compliance**: 14/14 scenarios compliant, 10/10 requirements met

## Verification Status

**Verdict**: PASS WITH WARNINGS  
**Critical blockers**: 0  
**Warnings**: 2 (both non-blocking, addressed in follow-up PR #90 or flagged for future attention)

### Warnings (from verify-report)

1. **REMINDERS_ENABLED=false not set in CI environment** (WARNING, per design.md § Rollout)
   - **Status**: Fixed in PR #90 — backend/.env and .github/workflows/ci.yml now set `REMINDERS_ENABLED=false`
   - **Impact**: Prevents cron from executing during e2e/CI runs, avoiding fixture pollution
   - **Evidence**: PR #90 merged to main at HEAD f4c82e1

2. **Intermittent e2e timeouts on local Windows dev** (WARNING, unrelated to this change)
   - **Status**: Investigated; not a code defect but local Postgres/ts-jest contention
   - **Impact**: No impact; notifications.e2e-spec.ts (covering this change's requirements) passed all 3 runs
   - **Observed**: Full 16-suite e2e run shows non-deterministic beforeAll timeouts on unrelated suites (documents, mfa-recover, rbac-ownership, patient-consent), rotating, never same twice; each suite passes standalone
   - **Attribution**: Likely local connection pool contention, not session-reminders code
   - **Recommendation**: Flagged for maintainer awareness; not a blocker

### All Spec Requirements Verified

**session-reminders** (6 requirements, 9 scenarios):
- ✅ Two-Offset Detection Window — 24h and 2h independently tracked and fired
- ✅ Exactly-Once Delivery Per (Consultation, Offset, Channel) — unique constraint prevents re-send
- ✅ Late-Created Session Fires Immediately — nearest-offset-only logic + SKIPPED audit trail
- ✅ Reschedule Re-Arms All Offsets — (groupId, sessionDate, offsetKind, channel) key logic
- ✅ Soft-Deleted Consultations Are Excluded — WHERE deletedAt:null, correctedBy:null
- ✅ Email Channel Degrades Gracefully — RESEND_API_KEY missing still yields in-app notifications

**in-app-notifications** (3 requirements, 5 scenarios):
- ✅ Therapist-Scoped Persistence — userId isolation on all CRUD operations
- ✅ Authorized, Owner-Scoped Retrieval — JwtAuthGuard + owner filtering, 401 on missing token
- ✅ Read/Unread Lifecycle Scoped to Owner — markRead uses (id, userId) compound check, returns 404 for non-owner

## Design Decisions Implemented

All 7 design decisions faithfully implemented:

1. **Dispatch-log table keyed on (groupId, sessionDate, offsetKind, channel)**
   - Enables automatic re-arm when `correct()` moves `sessionDate` (new key)
   - Text-only correction reuses key, stays silent (P2002 no-op)
   - `Consultation.reminderSent` fully removed and replaced

2. **Unique constraint as race-safe at-most-once guarantee**
   - Claim-then-send with `P2002` catch (no advisory locks)
   - Compatible with Supavisor transaction-mode pooling
   - Consistent with existing fire-and-forget `MailService` posture

3. **Due-ness as instant predicate, not time band**
   - Predicate: `sessionDate.getTime() - offsetMs <= now.getTime() < sessionDate.getTime()`
   - Delayed tick still fires; session created 3h out fires 24h offset on next tick
   - Dispatch log prevents duplicate on subsequent ticks

4. **When multiple offsets simultaneously due, only nearest fires**
   - E.g., session created 10 min out: only 2h dispatches, 24h recorded SKIPPED
   - SKIPPED still occupies unique key, preventing future dispatch
   - Matches business rule interpretation (no back-to-back emails for same session)

5. **UTC instant arithmetic; explicit render zone**
   - All due-ness math on Date instants (UTC)
   - Render via Intl.DateTimeFormat('es-CL', timeZone: 'America/Santiago')
   - DST transitions cannot shift offsets

6. **No ConsultationsService hook**
   - `create`/`correct` emit nothing; poller discovers via next 5-min tick
   - Decouples clinical write path from email infrastructure
   - Worst-case latency: 5 min against 24h horizon

7. **Notification is channel-generic, not reminder-shaped**
   - `type` enum + `title`/`body`/`linkPath`/`metadata`
   - No consultationId FK; supports future slices (Google Calendar, patient invites)

## Rollback Boundary

Additive and isolated:
1. Disable or remove `ScheduleModule.forRoot()` — reminders stop immediately, zero data loss
2. Revert frontend surface
3. Revert `MailService` method and `notifications` module
4. Reverse Prisma migration (drops additive tables/columns; no clinical data touched)

No existing behavior modified; stopping at step 1 is safe in isolation.

## Dependencies Introduced

- `@nestjs/schedule` (npm only; no new runtime service)
- Existing `RESEND_API_KEY` configuration (already used by MailService)

## Open Questions

None. All business rules and risks resolved during proposal and design phases. See proposal.md § Open Questions for resolved items.

## SDD Cycle Traceability

| Phase | Artifact Path | Status |
|-------|---------------|--------|
| Proposal | `openspec/changes/archive/2026-08-25-session-reminders/proposal.md` | ✅ Archived |
| Spec | `openspec/changes/archive/2026-08-25-session-reminders/spec.md` | ✅ Archived |
| Design | `openspec/changes/archive/2026-08-25-session-reminders/design.md` | ✅ Archived |
| Tasks | `openspec/changes/archive/2026-08-25-session-reminders/tasks.md` | ✅ Archived |
| Verify Report | `openspec/changes/archive/2026-08-25-session-reminders/verify-report.md` | ✅ Archived |
| Archive Report | `openspec/changes/archive/2026-08-25-session-reminders/archive-report.md` | ✅ Generated |

## Final State Authority

This report describes the state of the change AT ARCHIVE (2026-08-25), not earlier snapshots:

- **Native review authority**: Not applicable (no receipt-driven development enabled for this change)
- **Persisted tasks artifact**: `tasks.md` — 40/40 tasks checked complete ✅
- **Explicit final-state facts from status**: `archive: ready`, `verify: all_done`, `task_progress: 40/40 complete`
- **Intermediate snapshots**: verify-report.md is a point-in-time snapshot; work completed after it was written (specifically, PR #90 fixing the REMINDERS_ENABLED=false warning) has been recorded above

**Reconciliation**: 
- Verify-report warned that `REMINDERS_ENABLED=false` was missing from CI/e2e configs. This was **fixed in PR #90** (merged to main) before archive, so the final state reflects the corrected environment.
- Local Windows e2e flakiness (timeouts on unrelated suites) was investigated and **attributed to environment contention**, not code defects; notifications.e2e-spec.ts (covering this change's tenancy/route-order tests) passed all runs.

## Closure Checklist

- [x] All 40 implementation tasks checked complete in `tasks.md`
- [x] Verification report: PASS WITH WARNINGS (no critical blockers)
- [x] All 4 PRs merged to main
- [x] Specs synced to `openspec/specs/reminders/spec.md` and `openspec/specs/notifications/spec.md`
- [x] Change folder moved to `openspec/changes/archive/2026-08-25-session-reminders/`
- [x] Source directory removed from `openspec/changes/`
- [x] Archive integrity verified (diff: empty)
- [x] Archive report persisted

## Next Steps

**No further work required for session-reminders.** The SDD cycle is complete and closed.

**Recommendations for future work**:
1. Monitor for the two warnings in production: confirm REMINDERS_ENABLED gate behavior and any e2e flakiness resolution
2. Consider slices 2 (patient calendar invite) and 3 (Google Calendar sync) per proposal § Scope, both reusing the in-app-notifications infrastructure built here
3. Optional: add retention/purge job for notifications (design.md § Migration/Rollout mentions this as a follow-up)

---

**Archive Report Generated**: 2026-08-25  
**Archived By**: sdd-archive phase  
**SDD Cycle**: Closed ✅
