# Apply Progress: Session Calendar View + Settings Split

This artifact aggregates all apply batches across worktrees/PRs for this change. Each batch section below is self-contained (own worktree, branch, evidence); do not overwrite prior sections when adding a new batch.

**Chain status**: PR1 (#98), PR3 (#99), PR2a (#100), PR2b (#101), PR4 (#102) all merged to `main`. Change complete, all 5 phases done. Ready for `sdd-verify` and archive.

---

## Batch: PR1 — Backend Range Endpoint (Phase 1, tasks 1.1-1.7)

**Mode**: Strict TDD
**Worktree**: C:\desarrollo\umbral-personal-worktrees\session-calendar-view-pr1 (removed after merge)
**Branch**: session-calendar-view-pr1-backend-range-endpoint (merged, deleted)

### Completed Tasks
- [x] 1.1-1.7 — see tasks.md Phase 1. `findByRange`, span guard, sync map, route ordering, unit (8 tests) + integration (2 tests, real Postgres, DST boundary).

### Files Changed
- `backend/src/modules/consultations/dto/consultation-range-query.dto.ts` — Created
- `backend/src/modules/consultations/consultations.service.ts` — Modified (`CalendarSession` interface, `findByRange()`, `getSyncStatusMap()`)
- `backend/src/modules/consultations/consultations.controller.ts` — Modified (`@Get('range')` before `@Get(':id')`)
- `backend/src/modules/consultations/consultations.service.spec.ts` / `.integration.spec.ts` — new tests

### Post-Apply Review Fix (orchestrator, before commit)
`@IsDateString()` alone accepts date-only strings (`"2026-09-01"` is valid ISO8601), which would silently reintroduce the server-local-midnight ambiguity this endpoint exists to avoid — the DTO's own comment declared the offset-explicit intent but nothing enforced it. Added `@Matches(ISO_INSTANT_WITH_OFFSET)` to both `from`/`to` in `consultation-range-query.dto.ts`, plus `consultation-range-query.dto.spec.ts` (4 cases: offset-explicit accepted, `Z` accepted, date-only rejected, garbage rejected). Re-ran `consultations.service.spec.ts` (26/26), `tsc --noEmit`, `eslint` — all clean.

### Key Discovery
Derived actual Chile `America/Santiago` DST transition instants for 2026 empirically via Node's ICU (`Intl.DateTimeFormat`) instead of hand-computing from the legislative rule. Confirmed: spring-forward at `2026-09-06T04:00:00Z`, fall-back at `2026-04-05T03:00:00Z`. Reuse this derivation approach for PR4's `chileMonthGridRange` (frontend).

### Status
Merged to `main` as PR #98 (commit `a76fad8` + merge `2612a5c`).

---

## Batch: PR3 — Extract ConsultationForm (Phase 2, tasks 2.1-2.3)

**Mode**: Strict TDD → Approval Testing variant (pure extraction, zero new behavior)
**Worktree**: C:\desarrollo\umbral-personal-worktrees\session-calendar-view-pr3 (removed after merge)
**Branch**: session-calendar-view-pr3-extract-consultation-form (merged, deleted)

> Note: this batch's original Engram write was lost to a topic_key race with PR1's parallel write (both ran concurrently against `sdd/session-calendar-view/apply-progress`, last write won). Reconstructed here from the batch's own completion report for continuity; the code itself was never at risk — it landed via PR #99.

### Completed Tasks
- [x] 2.1 Created `frontend/src/components/consultations/ConsultationForm.tsx` — extracted form state, 4 validations, `useCreateConsultation`, `usePatients`, `buildLocalISO`. Props `{initialDate?, initialTime?, onSuccess, onCancel}` (initialDate/initialTime wired but unused until PR4).
- [x] 2.2 `ConsultationsPage.tsx` — replaced inline form with `<ConsultationForm />`, page still owns title + close X (PR4's modal supplies its own chrome).
- [x] 2.3 Regression: `ConsultationsPage.spec.tsx` 4/4 passing before and after, identical assertions — zero behavior drift.

### Verification
Full frontend suite 62/62 passing, `tsc -b` clean, lint clean.

### Status
Merged to `main` as PR #99 (commit `db51caf` + merge `6162588`).

---

## Batch: PR2a — Settings Split: Pages + Routing (Phase 3, tasks 3.1-3.6 + reassigned 4.4)

**Mode**: Strict TDD (Approval Testing variant for the relocation)
**Worktree**: C:\desarrollo\umbral-personal-worktrees\session-calendar-view-pr2a (removed after merge)
**Branch**: session-calendar-view-pr2a-settings-split-pages (merged, deleted)

### Completed Tasks
- [x] 3.1 `frontend/src/hooks/useProfile.ts` — shared `GET /profile`, `queryKey: ['profile']`, global 30s staleTime.
- [x] 3.2 `frontend/src/pages/ProfilePage.tsx` — name/email/password only.
- [x] 3.3 `frontend/src/pages/SecurityPage.tsx` — MFA + history + Google Calendar panel + `?calendar=` banner.
- [x] 3.4 `App.tsx` — `/profile`, `/security` routes; `/settings` → `Navigate to="/security"`.
- [x] 3.5 `Layout.tsx` — navLinks Perfil/Seguridad (Calendario deferred to PR4).
- [x] 3.6 Deleted `SettingsPage.tsx`.
- [x] **Reassigned from 4.4** — Deleted `SettingsPage.spec.tsx` in this PR, not PR2b.

### Post-Apply Review Fix (orchestrator, before commit)
The apply batch left `SettingsPage.spec.tsx` alive importing the just-deleted `./SettingsPage`, per the original task split (4.4 assigned to PR2b). Deferring the deletion would have left `main` with a broken build/test suite for the entire window between PR2a merging and PR2b merging — a real risk since PR2a was independently mergeable in principle. Deleted `SettingsPage.spec.tsx` in PR2a itself instead. Re-verified: 51/51 tests, `tsc -b` clean, `eslint` clean. This is why PR2b's task 4.4 required no action (see that batch below).

### Issues Found (fixed during apply)
Adopting `useProfile()` tripped `react-hooks/set-state-in-effect` in 3 places (verified against 0-error baseline of the original file). Fixed by extracting `AccountDataForm`/`MfaCard` child components using lazy `useState` initializers instead of `useEffect`+`setState`.

### Status
Merged to `main` as PR #100 (commit `89d98eb` + merge `db5d653`).

---

## Batch: PR2b — Settings Split: OAuth Constant + Specs (Phase 4, tasks 4.1-4.3)

**Mode**: Strict TDD
**Worktree**: C:\desarrollo\umbral-personal-worktrees\session-calendar-view-pr2b (removed after merge)
**Branch**: session-calendar-view-pr2b-oauth-const-specs (merged, deleted) — stacked on PR2a's branch, retargeted to `main` after PR2a merged.

### Scope Correction
Task 4.4 ("Delete `SettingsPage.spec.tsx`") was executed in PR2a instead (see that batch) to keep PR2a independently mergeable. Confirmed absent in this worktree at batch start — no action needed here beyond marking `[x]` with this note.

### Completed Tasks
- [x] 4.1 `calendar-integration.controller.ts` — `CALENDAR_RETURN_PATH = '/security'` constant, replaces both `/settings?calendar=...` hardcodes in `callback()`. RED/GREEN via `calendar-integration.e2e-spec.ts` (tightened 2 redirect assertions to the exact path).
- [x] 4.2 Created `ProfilePage.spec.tsx` (3 tests): identity fields render, no MFA/Calendar control.
- [x] 4.3 Created `SecurityPage.spec.tsx` (7 tests): MFA + full Calendar panel render, `?calendar=connected|error` banners, no identity fields.
- [x] 4.4 — done in PR2a, confirmed only.

### Post-Merge Operational Note (orchestrator)
This PR was opened stacked on PR2a's branch. After PR2a merged to `main`, GitHub did not auto-retarget it (base branch still existed remotely, delete-branch had failed locally due to worktree lock) and its CI (`ci.yml`, `on: pull_request: branches: [main]`) had never run since it originally targeted a non-`main` base. Retargeted to `main` via `gh pr edit --base main`, pushed an empty commit to trigger the `synchronize` event, waited for `backend`/`frontend` checks to go green (both passed), then merged.

### Status
Merged to `main` as PR #101 (commits `98434a9`, `ab2b738` + merge `d4fcc34`).

---

## Batch: PR4 — Calendar UI (Phase 5, tasks 5.1-5.10)

**Mode**: Strict TDD
**Worktree**: C:\desarrollo\umbral-personal-worktrees\session-calendar-view-pr4
**Branch**: session-calendar-view-pr4-calendar-ui (created from `origin/main`, not yet committed/pushed)

### Safety Net
Baseline before any change: `npm test` → 11 test files, 61 tests passing. Re-run after all changes: 14 test files, 75 tests passing (+14 new: 5 `datetime.spec.ts`, 2 `useCalendarSessions.spec.tsx`, 7 `CalendarPage.spec.tsx`).

### Completed Tasks
- [x] 5.1 `utils/datetime.ts` — added `toChileDayKey(iso)` (Chile-local day bucketing via `en-CA` `Intl` formatting) and `chileMonthGridRange(year, month)` (fixed 42-cell/6x7 grid, week starts Monday, half-open `{from, to, days}`, reuses existing `buildLocalISO` to resolve the correct Chile offset per grid boundary). Also added `formatChileTime(iso)` (HH:mm in Chile) as a small supporting helper shared by `DayCell`/`DayDetailModal` — not in the original task list but a natural extension of the same file, avoids duplicating the Intl time-formatting logic twice.
- [x] 5.2 `api/consultations.ts` — `CalendarSession` interface (mirrors backend `ConsultationsService.CalendarSession` exactly, confirmed by reading the real service, not guessed: `id, groupId, sessionDate, sessionType, patientId, patientName, calendarSync`, `calendarSync: 'SYNCED' | 'FAILED' | null` confirmed against the Prisma `CalendarSyncStatus` enum) + `listConsultationsByRange(from, to)` (`GET /consultations/range` with `{ params: { from, to } }`).
- [x] 5.3 `hooks/useCalendarSessions.ts` — `queryKey: ['consultations', 'range', from, to]`, exact key verified by a dedicated test reading `queryClient.getQueryData([...])` under that literal key (not just asserting the fetch happened).
- [x] 5.4 `components/calendar/MonthGrid.tsx` — 7-col Tailwind grid, Lunes-first weekday header (`Lun..Dom`, consistent with `chileMonthGridRange`'s Monday-start), renders all 42 `days` from the grid range including spillover cells; `isCurrentMonth` derived by comparing each day's month segment to the requested month.
- [x] 5.5 `components/calendar/DayCell.tsx` — day number, up to 3 session chips (`HH:mm patientName`, via `formatChileTime`), `+N más` overflow text when `sessions.length > 3`. Whole cell is one `<button>` (no nested interactive elements) with `data-testid="day-cell-{day}"`.
- [x] 5.6 `components/calendar/DayDetailModal.tsx` — read-only session list (patientName, time, sessionType label), "Agendar sesión" button toggles to mount `ConsultationForm` (from PR3) with `initialDate={day}` / `initialTime="09:00"`, `onSuccess={onClose}` (closes the whole modal — the grid refetches automatically via the existing `['consultations']` invalidation), `onCancel` returns to the read-only list. No edit/cancel control on any listed session (session-calendar Req: Read-Only Day Detail Modal).
- [x] 5.7 `components/calendar/CalendarSyncBadge.tsx` — reads `GET /calendar-integration/status` directly (confirmed against spec.md's own wording: "MUST show a read-only Google Calendar status badge from `GET /calendar-integration/status`" — not derived from each row's `calendarSync`), renders a `react-router` `Link` to `/security` with a status label, no connect/disconnect button (session-calendar Req: Google Calendar Status Badge).
- [x] 5.8 `pages/CalendarPage.tsx` — `viewMonth` state defaulting to "today" anchored in Chile (`toChileDayKey(new Date().toISOString())`, not device-local time, consistent with the rest of the module), `groupByChileDay(sessions)` (buckets by `toChileDayKey(session.sessionDate)` — session-calendar Req: Session Date Anchoring), prev/next month navigation, `DayDetailModal` wiring on day click.
- [x] 5.9 `App.tsx` + `Layout.tsx` — `/calendar` lazy route next to `/consultations`; `Layout.tsx` navLinks now Dashboard/Pacientes/Consultas/**Calendario**/Repositorio/Perfil/Seguridad (`CalendarDays` icon), matching design.md's nav order exactly.
- [x] 5.10 RED `CalendarPage.spec.tsx` (7 tests, all written before their production code): exact grid range fetch (`from`/`to` cross-checked against the same DST-derived values as `datetime.spec.ts`); grid spillover cells present (`day-cell-2026-08-31`, `day-cell-2026-10-11`); Chile-day bucketing across the spring-forward instant (`2026-09-06T04:00:00Z`) placing two sessions one minute apart on different day cells; 4-session overflow ("+1 más"); read-only day modal (no "corregir"/"cancelar sesión" controls, "Agendar sesión" present); "Agendar sesión" opens `ConsultationForm` prefilled with the clicked day; badge shows status + links to `/security` with no connect/disconnect button.

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 | `frontend/src/utils/datetime.spec.ts` | Unit | ✅ 61/61 (full suite, no pre-existing direct spec for this file) | ✅ Written | ✅ 5/5 passed | ✅ 2 months (Sept/April) + 3 DST-boundary cases for `toChileDayKey` | ✅ Clean (shared `dateKeyFromUTCComponents`/`pad2` helpers) |
| 5.2 | Covered by `useCalendarSessions.spec.tsx` (5.3) and `CalendarPage.spec.tsx` (5.10) | Unit (indirect) | N/A (new fields on existing file) | N/A | ✅ Exercised via 5.3/5.10 | ➖ Single (thin passthrough, same shape as `listConsultationsByPatient` — matches repo convention of not unit-testing `api/*.ts` directly) | ➖ None needed |
| 5.3 | `frontend/src/hooks/useCalendarSessions.spec.tsx` | Unit (react-query hook) | N/A (new) | ✅ Written | ✅ 2/2 passed | ✅ 2 cases (fetch/data shape + exact queryKey via `getQueryData`) | ➖ None needed |
| 5.4-5.8 | `frontend/src/pages/CalendarPage.spec.tsx` | Integration (page + subcomponents, react-query + react-router) | N/A (new) | ✅ Written first (confirmed `Failed to resolve import "./CalendarPage"`) | ✅ 7/7 passed after 2 test-assertion fixes (async `within(...).findByText` for late-loading cell data, `toHaveAttribute` instead of nested `getByRole('link')` since the testid element IS the anchor) | ✅ 7 scenarios covering all sub-components together (grid range fetch, spillover, DST bucketing, overflow, read-only modal, prefill, badge) | ✅ Clean |
| 5.9 | Covered by `CalendarPage.spec.tsx` rendering the page itself; route/navLink wiring is structural (no `App.spec.tsx`/`Layout.spec.tsx` exists in this repo's convention) | N/A | N/A | N/A | ✅ `tsc -b` + `eslint` clean, manual read of `App.tsx`/`Layout.tsx` diff | ➖ Single (mechanical wiring, one possible correct shape) | ➖ None needed |
| 5.10 | `frontend/src/pages/CalendarPage.spec.tsx` | Integration | N/A (new) | ✅ Written before any component existed | ✅ 7/7 | ✅ 7 distinct scenarios | ✅ Clean |

### Test Summary
- **Total tests written**: 14 (5 + 2 + 7)
- **Total tests passing**: 14/14 new, 75/75 full frontend suite
- **Layers used**: Unit (7 — datetime + hook), Integration (7 — CalendarPage + all calendar subcomponents rendered together)
- **Approval tests** (refactoring): None — no refactoring tasks, all new behavior
- **Pure functions created**: `toChileDayKey`, `chileMonthGridRange`, `formatChileTime`, `groupByChileDay`, `addMonths`, `chileTodayViewMonth` (all in `datetime.ts`/`CalendarPage.tsx`, zero side effects)

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run src/pages/CalendarPage.spec.tsx` → 7/7 passed (also `src/utils/datetime.spec.ts` 5/5, `src/hooks/useCalendarSessions.spec.tsx` 2/2) |
| Runtime harness command/scenario and exact result | manual: month nav + day click — not executed live (no dev server in this batch); covered instead by the full `CalendarPage.spec.tsx` integration test exercising the real `MonthGrid`→`DayCell`→`DayDetailModal`→`ConsultationForm` tree with mocked `api/client`, per tasks.md's own "Runtime harness" column for Unit 5 |
| Rollback boundary | Revert `App.tsx`/`Layout.tsx` route+navLink additions and delete `pages/CalendarPage.tsx` + `components/calendar/`; page becomes unreachable, zero impact on PR1/PR3/PR2a/PR2b code (matches tasks.md's own rollback boundary for Unit 5) |

### Full Verification (before returning control)
- `npm test` (frontend, full suite): 14 test files, 75 tests passed.
- `npm run lint` (`eslint .`): clean, zero warnings/errors.
- `npx tsc -b`: clean, zero errors.
- Backend untouched in this batch (PR4 is frontend-only per design.md's File Changes table) — backend suite not re-run.

### Deviations from Design
None — implementation matches design.md's "File Changes", "Interfaces / Contracts", "Data Flow", and nav-order sections exactly. Two additions beyond the literal task list, both minor and in-scope: `formatChileTime` helper in `datetime.ts` (natural extension, avoids duplicating Intl formatting across `DayCell`/`DayDetailModal`), and `CalendarSyncBadge` confirmed to call `GET /calendar-integration/status` directly (per spec.md's own wording) rather than reading `calendarSync` off each `CalendarSession` row — the per-row field exists in the payload but is unused by the badge; it remains available for a future per-session sync indicator if ever needed, out of scope here.

### Issues Found
Two test-assertion bugs caught during the GREEN run (not production bugs): (1) `within(cell).getByText(...)` on the 4-session overflow test queried before the async `useCalendarSessions` fetch resolved — fixed with `findByText` for the first assertion in that block. (2) `within(badge).getByRole('link')` searched for a *descendant* link, but `data-testid="calendar-sync-badge"` is set on the anchor itself (`CalendarSyncBadge` renders a bare `react-router` `Link`) — fixed to assert `toHaveAttribute('href', ...)` directly on `badge`.

### Status
Merged to `main` as PR #102 (commit `ce26c70` + merge `39ce6c6`).

---

## Post-Chain Housekeeping (orchestrator)

- Worktrees for PR1/PR3/PR2a/PR2b removed (`git worktree remove --force`); local and remote branches deleted post-merge.
- `openspec/changes/session-calendar-view/` on `main` only carried PR1's commit of the SDD artifacts (proposal/spec/design/tasks) — PR3/PR2a/PR2b deliberately excluded that folder from their diffs to avoid divergent copies across parallel branches. This file and `tasks.md` were updated directly on `main` post-merge to reflect the true completed state of Phases 1-4.
- `sdd/session-calendar-view/apply-progress` (Engram) lost PR3's original batch section to a topic_key write race between the two agents that ran PR1 and PR3 in parallel (both write to the same topic_key; last write wins). Reconstructed above from that batch's completion report. No code was at risk — only the Engram narrative. See learning `pattern/pr2a-settingspage-split-lint-gotcha-with-usequery-derived-state` (obs #1258) and `Do not chain mem_save after mem_update on same topic_key` (obs #1259) for related process notes from this change.

## Next

Change complete — all 5 phases merged to `main` (PRs #98, #99, #100, #101, #102). Next: `sdd-verify` against spec/tasks, then `sdd-archive`.
