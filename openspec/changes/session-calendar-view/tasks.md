# Tasks: Session Calendar View + Settings Split

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | PR1 ~250 · PR3 ~160 · PR2a ~1300 · PR2b ~635 · PR4 ~380 |
| 400-line budget risk | Low (PR1, PR3, PR4) · **High (PR2a, PR2b)** |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR3 (parallel) → PR2a → PR2b → PR4 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main (matches PRs #92–95) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Decision (user, size:exception)**: PR2a (~1295) and PR2b (~634) accepted over budget as-is — mostly mechanical relocation of existing code (page split, no new complex logic), not further partitioned. PR1, PR3, PR4 remain under `auto-chain`/stacked-to-main at their forecast size.

**Re-forecast (measured, not estimated)**: `SettingsPage.tsx` is 628 lines, `SettingsPage.spec.tsx` 295 lines today. Design's 2a/2b split is applied below, but delete+recreate of both files dominates: 2a (pages+hook+routes+navLinks, no delete of old file avoided) ≈ 628 del + 210 Profile + 377 Security + 45 hook + 35 routes/nav ≈ **1295**; 2b (spec split+OAuth const) ≈ 295 del + 153 + 176 spec + 10 const ≈ **634**. Both exceed budget even after the split design suggested — flag for maintainer: accept `size:exception` per sub-slice, or split further (2a into pages-only / routing-only; 2b into per-page spec commits).

### Suggested Work Units

| Unit | Goal | PR | Focused test | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | `GET /consultations/range` | PR1 | `consultations.service.spec.ts` | `npm run test:integration -w backend` | Revert DTO+route+service, additive/read-only |
| 2 | Extract `ConsultationForm` | PR3 | `ConsultationsPage.spec.ts` | manual: create session in Consultas | Revert to inline form, no behavior change |
| 3 | Profile/Security pages+hook+routes | PR2a | `ProfilePage.spec.tsx` / `SecurityPage.spec.tsx` | manual: nav Perfil/Seguridad | Restore `SettingsPage.tsx` from git history |
| 4 | OAuth const + spec split | PR2b | `SecurityPage.spec.tsx` (calendar block) | manual OAuth round-trip via `?calendar=` | Revert constant + spec files independently |
| 5 | Calendar UI | PR4 | `CalendarPage.spec.tsx` | manual: month nav + day click | Remove route+navLink, page becomes unused |

## Phase 1: Backend Range Endpoint (PR1)

- [x] 1.1 `dto/consultation-range-query.dto.ts`: `from`/`to`, both `@IsDateString()`.
- [x] 1.2 `consultations.service.ts`: `findByRange(therapistId, query)` — `sessionDate:{gte:from,lt:to}`, `correctedBy:null`, `deletedAt:null`.
- [x] 1.3 Span guard: `to<=from` or span >62 days → `BadRequestException`.
- [x] 1.4 Sync map: `calendarEventLink.findMany({groupId:{in:[...]}})` → `Map<groupId,status>`, merge into response.
- [x] 1.5 `consultations.controller.ts`: `@Get('range')` declared before `@Get(':id')`.
- [x] 1.6 RED unit: `correctedBy`/`deletedAt` filtering, half-open boundary, span guard, sync map (`consultations.service.spec.ts`).
- [x] 1.7 RED integration: real Prisma — corrected chain shown once; DST-boundary month (Sep/Apr, Chile) returns edge sessions (`consultations.service.integration.spec.ts`).

## Phase 2: Extract ConsultationForm (PR3, parallel to PR1)

- [ ] 2.1 Create `components/consultations/ConsultationForm.tsx`: form state, 4 validations, `useCreateConsultation`, `buildLocalISO`; props `{initialDate?, initialTime?, onSuccess, onCancel}`.
- [ ] 2.2 `ConsultationsPage.tsx`: replace inline create form with `ConsultationForm`.
- [ ] 2.3 Regression: existing `ConsultationsPage.spec.tsx` create flow passes unchanged (no behavior change).

## Phase 3: Settings Split — Pages + Routing (PR2a)

- [ ] 3.1 `hooks/useProfile.ts`: `queryKey:['profile']`, 30s `staleTime`, wraps `GET /profile`.
- [ ] 3.2 Create `pages/ProfilePage.tsx`: name/email/password only, no MFA/Calendar control.
- [ ] 3.3 Create `pages/SecurityPage.tsx`: MFA + history + Google Calendar panel + `?calendar=` banner.
- [ ] 3.4 `App.tsx`: routes `/profile`, `/security`; `/settings` → `<Navigate to="/security" replace/>`.
- [ ] 3.5 `Layout.tsx`: navLinks Perfil (`UserCog`) + Seguridad (`ShieldCheck`), order Dashboard/Pacientes/Consultas/Calendario/Repositorio/Perfil/Seguridad.
- [ ] 3.6 Delete `SettingsPage.tsx`.

## Phase 4: Settings Split — OAuth Constant + Specs (PR2b)

- [ ] 4.1 `calendar-integration.controller.ts`: `CALENDAR_RETURN_PATH='/security'` constant, replace L69/L74 hardcode.
- [ ] 4.2 Create `ProfilePage.spec.tsx`: identity fields render; no MFA/Calendar control present (account-settings Req: Profile Section Scope).
- [ ] 4.3 Create `SecurityPage.spec.tsx`: MFA + Calendar controls render; `?calendar=connected|error` banner both cases; controls not duplicated in Calendario (account-settings Req: Security Section Scope, OAuth Redirect Resolution).
- [ ] 4.4 Delete `SettingsPage.spec.tsx`.

## Phase 5: Calendar UI (PR4, depends on PR1 + PR3)

- [ ] 5.1 `utils/datetime.ts`: `toChileDayKey(iso)`, `chileMonthGridRange(y,m)` — half-open, includes spillover cells.
- [ ] 5.2 `api/consultations.ts`: `listConsultationsByRange(from,to)` + `CalendarSession` type.
- [ ] 5.3 `hooks/useCalendarSessions.ts`: `queryKey:['consultations','range',from,to]`.
- [ ] 5.4 `components/calendar/MonthGrid.tsx`: 7-col Tailwind grid, weekday header, renders adjacent-month spillover cells.
- [ ] 5.5 `components/calendar/DayCell.tsx`: day number, session chips, `+N más` overflow.
- [ ] 5.6 `components/calendar/DayDetailModal.tsx`: read-only session list, "Agendar sesión" mounts `ConsultationForm` (session-calendar Req: Read-Only Day Detail Modal).
- [ ] 5.7 `components/calendar/CalendarSyncBadge.tsx`: status-only, links `/security`, no connect/disconnect control (session-calendar Req: Google Calendar Status Badge).
- [ ] 5.8 `pages/CalendarPage.tsx`: month state, `groupByChileDay`, modal wiring.
- [ ] 5.9 `App.tsx` + `Layout.tsx`: `/calendar` route + `Calendario` navLink (`CalendarDays`).
- [ ] 5.10 RED `CalendarPage.spec.tsx`: Chile day bucketing across DST; grid renders spillover cells; modal is read-only (no edit/cancel); badge has no inline control (session-calendar Req: Month Range Read Endpoint, Session Date Anchoring).
