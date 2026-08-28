# Apply Progress: Session Calendar View + Settings Split

This artifact aggregates all apply batches across worktrees/PRs for this change. Each batch section below is self-contained (own worktree, branch, evidence); do not overwrite prior sections when adding a new batch.

**Chain status**: PR1 (#98), PR3 (#99), PR2a (#100), PR2b (#101) all merged to `main`. Only Phase 5 (PR4, Calendar UI) remains.

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

## Post-Chain Housekeeping (orchestrator)

- Worktrees for PR1/PR3/PR2a/PR2b removed (`git worktree remove --force`); local and remote branches deleted post-merge.
- `openspec/changes/session-calendar-view/` on `main` only carried PR1's commit of the SDD artifacts (proposal/spec/design/tasks) — PR3/PR2a/PR2b deliberately excluded that folder from their diffs to avoid divergent copies across parallel branches. This file and `tasks.md` were updated directly on `main` post-merge to reflect the true completed state of Phases 1-4.
- `sdd/session-calendar-view/apply-progress` (Engram) lost PR3's original batch section to a topic_key write race between the two agents that ran PR1 and PR3 in parallel (both write to the same topic_key; last write wins). Reconstructed above from that batch's completion report. No code was at risk — only the Engram narrative. See learning `pattern/pr2a-settingspage-split-lint-gotcha-with-usequery-derived-state` (obs #1258) and `Do not chain mem_save after mem_update on same topic_key` (obs #1259) for related process notes from this change.

## Next

Phase 5 (PR4, Calendar UI) — depends on PR1 (merged) and PR3 (merged), both now satisfied. Ready to start.
