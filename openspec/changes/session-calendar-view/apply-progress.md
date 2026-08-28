# Apply Progress: Session Calendar View + Settings Split

## Scope of this batch

**Change**: `session-calendar-view`
**Unit**: PR1 — Backend Range Endpoint (Phase 1, tasks 1.1–1.7)
**Mode**: Strict TDD
**Worktree**: `C:\desarrollo\umbral-personal-worktrees\session-calendar-view-pr1`
**Branch**: `session-calendar-view-pr1-backend-range-endpoint`

Only Phase 1 (PR1) was implemented. Phases 2–5 (PR2a/PR2b/PR3/PR4) are untouched — `[ ]` in `tasks.md`.

## Completed Tasks

- [x] 1.1 `backend/src/modules/consultations/dto/consultation-range-query.dto.ts` — `from`/`to`, both `@IsDateString()`.
- [x] 1.2 `consultations.service.ts`: `findByRange(therapistId, query)` — `sessionDate:{gte:from,lt:to}`, `correctedBy:null`, `deletedAt:null`.
- [x] 1.3 Span guard: `to<=from` or span >62 days → `BadRequestException`.
- [x] 1.4 Sync map: `calendarEventLink.findMany({connection:{therapistId},groupId:{in:[...]}})` → `Map<groupId,syncStatus>`, merged into response (`calendarSync` field, `null` when absent).
- [x] 1.5 `consultations.controller.ts`: `@Get('range')` declared before `@Get(':id')`, matching the existing `stats` wildcard-hazard pattern.
- [x] 1.6 RED unit: `correctedBy`/`deletedAt` filtering, half-open boundary, span guard, sync map — `consultations.service.spec.ts` (8 new tests).
- [x] 1.7 RED integration: real Prisma — corrected chain shown once; DST-boundary month (Sep 2026, Chile) returns edge sessions — `consultations.service.integration.spec.ts` (2 new tests).

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `backend/src/modules/consultations/dto/consultation-range-query.dto.ts` | Created | `ConsultationRangeQueryDto` — `from`/`to: string`, both `@IsDateString()`. |
| `backend/src/modules/consultations/consultations.service.ts` | Modified | Added `CalendarSession` interface, `MAX_RANGE_SPAN_DAYS`/`MAX_RANGE_SPAN_MS` constants, `findByRange()`, private `getSyncStatusMap()`. |
| `backend/src/modules/consultations/consultations.controller.ts` | Modified | Added `@Get('range')` route, declared before `@Get(':id')`. |
| `backend/src/modules/consultations/consultations.service.spec.ts` | Modified | Added `describe('findByRange', ...)` — 8 unit tests, mocked Prisma. |
| `backend/src/modules/consultations/consultations.service.integration.spec.ts` | Modified | Added `describe('ConsultationsService.findByRange (integration, real Prisma)', ...)` — 2 integration tests against a real Postgres DB. |

No frontend, no other backend module, no migration touched — matches PR1's additive/read-only scope from design.md.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | (no dedicated DTO spec — matches project convention: no other DTO in `consultations/dto` has one) | — | N/A | N/A | N/A | Triangulation skipped: purely structural (decorator-only class, no branching) | ➖ None needed |
| 1.2–1.4 | `consultations.service.spec.ts` | Unit | ✅ 14/14 (pre-existing suite, run before any edit) | ✅ Written — 8 tests referencing `service.findByRange` before the method existed; confirmed failing via `TypeError: service.findByRange is not a function` (8 failed / 14 passed baseline) | ✅ Passed — 22/22 after implementing DTO+service+controller | ✅ 8 cases: query-shape filter, half-open boundary, `to<=from` guard, `>62 days` guard, exactly-62-days boundary, sync-map merge (SYNCED/FAILED/null), response-shape/no-PHI, no-link-query-when-empty | ✅ Extracted `MAX_RANGE_SPAN_DAYS`/`MAX_RANGE_SPAN_MS` constants and `getSyncStatusMap()` helper during GREEN itself (design already specified the split); no further extraction needed on re-read |
| 1.5 | Exercised indirectly via controller wiring; route-ordering hazard documented with the same pattern as `stats` | — | N/A (new route) | Implicit — controller compiles only once the DTO/service exist | ✅ Verified by successful `npx tsc --noEmit` + full e2e suite booting the module tree | ➖ Single (route declaration order is binary — before or after `:id`) | ➖ None needed |
| 1.6 | `consultations.service.spec.ts` | Unit | (same 14/14 baseline as above) | ✅ Written first | ✅ Passed | ✅ 8 cases (see above row) | ✅ Clean |
| 1.7 | `consultations.service.integration.spec.ts` | Integration | ✅ 2/2 (pre-existing suite, run before any edit) | ✅ Written — 2 tests referencing `consultationsService.findByRange` before the method existed; confirmed failing via `TypeError: consultationsService.findByRange is not a function` (2 failed / 2 passed baseline) | ✅ Passed — 4/4 after implementation, against a real local Postgres | ✅ 2 cases: corrected-chain-appears-once, DST-boundary edge sessions (4 sub-assertions: two edge sessions included, two out-of-range sessions excluded) | ✅ Clean — reused existing `buildConfig`/`flushMicrotasks` helper pattern from the sibling describe block in the same file |

### Test Summary
- **Total tests written**: 10 (8 unit + 2 integration)
- **Total tests passing**: 10/10 (plus 16 pre-existing consultations tests still green — 26/26 total in the module)
- **Layers used**: Unit (8), Integration (2), E2E (0 — no e2e-spec.ts task assigned to PR1)
- **Approval tests** (refactoring): None — no refactoring tasks in this batch
- **Pure functions created**: 0 new pure functions (span-guard math and sync-map building are private methods with one Prisma call each, not extracted further — kept consistent with `getHistory`/`historyMap` pattern already in the file)

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx jest src/modules/consultations` → `Test Suites: 2 passed, 2 total / Tests: 26 passed, 26 total` |
| Runtime harness command/scenario and exact result | `npx jest src/modules/consultations/consultations.service.integration.spec.ts` against a real local Postgres (see "Local Environment Setup" below) → `Test Suites: 1 passed, 1 total / Tests: 4 passed, 4 total` (2 pre-existing + 2 new) |
| Rollback boundary | Revert exactly 5 files: `consultation-range-query.dto.ts` (delete), `consultations.service.ts`, `consultations.controller.ts`, `consultations.service.spec.ts`, `consultations.service.integration.spec.ts`. Additive/read-only — no migration, no write path touched, no other module imports `findByRange` yet. |

## Full Verification Commands Run (exact, in order)

1. `npx jest src/modules/consultations/consultations.service.spec.ts` (baseline, pre-edit) → `14 passed, 14 total`
2. `npx jest src/modules/consultations/consultations.service.integration.spec.ts` (baseline, pre-edit) → `2 passed, 2 total`
3. `npx jest src/modules/consultations/consultations.service.spec.ts` (RED, after adding 8 `findByRange` tests, before implementing) → `8 failed, 14 passed, 22 total`
4. `npx jest src/modules/consultations/consultations.service.integration.spec.ts` (RED, after adding 2 `findByRange` tests, before implementing) → `2 failed, 2 passed, 4 total`
5. Implemented DTO + service + controller.
6. `npx jest src/modules/consultations/consultations.service.spec.ts` (GREEN) → `22 passed, 22 total`
7. `npx jest src/modules/consultations/consultations.service.integration.spec.ts` (GREEN) → `4 passed, 4 total`
8. `npx eslint "src/modules/consultations/**/*.ts"` → 2 errors (1 prettier formatting, 1 `no-unsafe-member-access`) → fixed (rewrote the boundary test to use `toHaveBeenCalledWith`/`objectContaining` instead of manual `.mock.calls[0][0]` indexing; ran `--fix` for the formatting-only issue) → re-run: clean, no errors
9. `npx tsc --noEmit -p tsconfig.json` → clean, no output
10. `npx jest src/modules/consultations` (post-lint-fix re-check) → `Test Suites: 2 passed, 2 total / Tests: 26 passed, 26 total`
11. `npm test` (full backend unit+integration suite) → `Test Suites: 30 passed, 30 total / Tests: 274 passed, 274 total`
12. `npm run test:e2e` (full backend e2e suite, after fixing a pre-existing local-env gap — see below) → `Test Suites: 17 passed, 17 total / Tests: 141 passed, 141 total`

## Local Environment Setup (worktree-specific, not part of the diff)

This worktree had no `backend/.env` and no running Postgres. To run the integration/e2e suites for real (not just claim green), the following was set up **outside the tracked diff** (`.env` is gitignored):

- Started Docker Desktop, then `docker compose up -d` from the main repo's `docker-compose.yml` (Postgres 16, container `umbral-postgres-local`, port 5432) — this container is shared infra, not specific to this worktree.
- Created `backend/.env` with `DATABASE_URL`/`DIRECT_URL` pointing at that Postgres, plus `JWT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `DOCUMENT_ENCRYPTION_KEY`, and dummy `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` (all freshly generated/local-only, no production secrets reused).
- `npx prisma migrate deploy` → `No pending migrations to apply` (schema already current) and `npx prisma generate`.
- `npm install` in `backend/`.

None of this is part of the code diff. It only existed to let strict-TDD RED/GREEN cycles run against a real test runner instead of being asserted without execution.

## Deviations from Design

None — implementation matches `design.md`:
- Half-open interval (`gte`/`lt`), no `parseDate()` reuse, exactly as "Decision: Range query params are ISO instants with explicit offset, half-open".
- Sync map via a second `calendarEventLink.findMany` call keyed by `groupId`, exactly as "Decision: Sync badge resolved in the same response, via in-memory map".
- Response shape excludes `consultReason`/`intervention`/`agreements`/`history`, exactly as "Decision: Grid payload excludes clinical narrative" and the `CalendarSession` contract in "Interfaces / Contracts".
- `@Get('range')` declared before `@Get(':id')`, matching the same wildcard hazard already solved for `stats`.

## Issues Found

None. One design-adjacent verification: derived the actual Chile `America/Santiago` DST transition instants for 2026 empirically via Node's ICU (`Intl.DateTimeFormat`) instead of hand-computing them from the legislative rule, to avoid hard-coding a wrong boundary date in the integration test. Confirmed: spring-forward (`-04:00`→`-03:00`) at `2026-09-06T04:00:00Z`, fall-back (`-03:00`→`-04:00`) at `2026-04-05T03:00:00Z`. The integration test uses September's boundary (`from=2026-09-01T00:00:00-04:00`, `to=2026-10-01T00:00:00-03:00`) with edge sessions exactly at `from` and just before `to`, both on the "wrong side" of the mid-range DST flip, plus two out-of-range sessions to prove the half-open boundary. This is worth remembering for PR4 (`chileMonthGridRange` on the frontend), which will need the same or a compatible derivation.

## Remaining Tasks (out of scope for this batch)

- [ ] Phase 2 (PR3): Extract `ConsultationForm` — tasks 2.1–2.3
- [ ] Phase 3 (PR2a): Settings split — pages + routing — tasks 3.1–3.6
- [ ] Phase 4 (PR2b): Settings split — OAuth constant + specs — tasks 4.1–4.4
- [ ] Phase 5 (PR4): Calendar UI — tasks 5.1–5.10

## Workload / PR Boundary

- Mode: chained PR slice (`auto-chain`, `stacked-to-main`, per tasks.md Review Workload Forecast)
- Current work unit: Unit 1 — `GET /consultations/range` (PR1)
- Boundary: starts from a clean worktree branched off `origin/main`; ends with exactly 5 files touched (1 new DTO, 2 new test describe-blocks, 1 service method + helper, 1 controller route) — no frontend, no migration.
- Estimated review budget impact: forecast was ~250 changed lines (Low risk). Actual diff is DTO (~10 lines) + service (~70 lines incl. comments) + controller (~10 lines) + ~330 lines of new test code across the two spec files — the test-code volume is larger than the ~250 estimate because Strict TDD required explicit RED-then-GREEN coverage for every scenario in the design's Testing Strategy row (filtering, half-open boundary, span guard both directions, sync map, response shape, corrected chain, DST edges), which the original ~250-line estimate likely under-counted for authored test lines. Flagging for maintainer awareness at PR time — still comfortably additive/read-only and independently revertible.

## Post-Apply Review Fix (orchestrator, before commit)

`@IsDateString()` alone accepts date-only strings (`"2026-09-01"` is valid ISO8601), which would silently reintroduce the server-local-midnight ambiguity this endpoint exists to avoid — the DTO's own comment declared the offset-explicit intent but nothing enforced it. Added `@Matches(ISO_INSTANT_WITH_OFFSET)` to both `from`/`to` in `consultation-range-query.dto.ts`, plus `consultation-range-query.dto.spec.ts` (4 cases: offset-explicit accepted, `Z` accepted, date-only rejected, garbage rejected). Re-ran `consultations.service.spec.ts` (26/26 still green), `tsc --noEmit`, and `eslint` on both touched files — all clean.

## Status

7/7 PR1 tasks complete + 1 review fix (DTO validation strictness). Ready for `sdd-verify` (scoped to PR1) or the next `sdd-apply` batch (PR2/PR3).
