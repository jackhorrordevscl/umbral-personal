# Design: Session Calendar View + Settings Split

## Technical Approach

Three independent seams: (1) an additive range-read endpoint in `consultations`, (2) an extraction of the existing create form so it can be mounted from two places, (3) a page split of `SettingsPage.tsx` plus the nav/route/OAuth-return contract. The calendar is a container/presentational tree over Tailwind grid + `Intl.DateTimeFormat` — no new dependency. All date bucketing is pinned to `America/Santiago`.

## Architecture Decisions

### Decision: Range query params are ISO instants with explicit offset, half-open

| Option | Tradeoff | Decision |
|---|---|---|
| `from`/`to` date-only (`YYYY-MM-DD`) | Would flow through `parseDate`, which builds `new Date(y, m-1, d, 12, 0, 0)` — **server-local**. On a UTC server the month boundary silently shifts 3–4h and edge sessions fall out of the grid. | Rejected |
| ISO instants with offset (`2026-09-01T00:00:00-04:00`) | Unambiguous; `new Date(str)` needs no timezone assumption. Frontend already produces exactly this via `buildLocalISO`. | **Chosen** |

`parseDate` is **not** reused for this endpoint. Interval is half-open: `sessionDate: { gte: from, lt: to }` — avoids `23:59:59.999` edge loss. The range covers the whole rendered 6×7 grid (including adjacent-month spillover cells), so those cells are not falsely empty. Service rejects `to <= from` or a span > 62 days with `BadRequestException`.

### Decision: Sync badge resolved in the same response, via in-memory map

`CalendarEventLink` has no FK to `Consultation` (it relates to `GoogleCalendarConnection` + a bare `groupId`), so a Prisma `include` is impossible. One extra `findMany({ where: { connection: { therapistId }, groupId: { in: groupIds } } })` mapped by `groupId` — the same N+1-avoidance pattern already used for `historyMap` in `findByPatient`. Rejected: a separate `/calendar-sync-status` call per grid render (N round-trips for a cosmetic badge).

### Decision: Grid payload excludes clinical narrative

Response carries `id, groupId, sessionDate, sessionType, patientId, patientName, calendarSync`. `consultReason`, `intervention`, `agreements` and `history` are **not** returned: a month view would ship ~30 clinical notes to render time + name chips. The day modal is read-only by proposal scope; the full note stays one click away in Consultas. Rejected: reusing the `findByPatient` shape (over-fetches PHI for a layout concern).

### Decision: Extract the create form instead of navigating away

| Option | Tradeoff | Decision |
|---|---|---|
| Extract `components/consultations/ConsultationForm.tsx`, mount in both pages | ~1 mechanical refactor PR; one DTO source of truth; therapist stays in the calendar | **Chosen** |
| Navigate to `/consultations` with router state prefill | Comparable code volume, but loses calendar context and adds `useLocation().state` plumbing | Rejected |
| Duplicate the form JSX | Guaranteed drift on a clinical DTO | Rejected |

The component owns `form` state, the four validations, `useCreateConsultation` and `buildLocalISO`; props: `{ initialDate?, initialTime?, onSuccess, onCancel }`. `Modal.tsx`'s focus trap recomputes focusables per Tab, so a form inside the day modal traps correctly.

### Decision: `useProfile` react-query hook shared by both split pages

`GET /profile` feeds Perfil (`name`/`email`/`pendingEmail`) and Seguridad (`mfaEnabled`). Today it is a raw `api.get` in `useEffect`; after the split that would become two fetches. `hooks/useProfile.ts` (`queryKey: ['profile']`) dedupes under the existing 30s `staleTime` and matches the dominant app pattern (`usePatients`, `useConsultations`). Nothing else is shared — no `SettingsLayout` wrapper, since tabs were explicitly rejected.

### Decision: OAuth return path is a module constant pointing at `/security`

`CALENDAR_RETURN_PATH = '/security'` next to `DEFAULT_FRONTEND_URL`; redirect becomes `` `${frontendUrl}${CALENDAR_RETURN_PATH}?calendar=connected|error` ``. Rejected: an env var (the path is a frontend route shape, not a deployment concern — a typo would 404 with no compile signal). `/settings` is additionally kept in `App.tsx` as `<Navigate to="/security" replace />`, so an old backend deploy still lands correctly mid-rollout and bookmarks survive.

## Data Flow

    CalendarPage (viewMonth state)
      └─ chileMonthGridRange(y,m) ──→ GET /consultations/range?from&to
                                          │
                          ConsultationsService.findByRange
                            ├─ consultation.findMany (therapistId, correctedBy:null, deletedAt:null, gte/lt)
                            └─ calendarEventLink.findMany (groupId in [...]) ──→ Map<groupId, syncStatus>
                                          │
      groupByChileDay(sessions) ──→ MonthGrid ──→ DayCell ──→ DayDetailModal
                                                                  └─ ConsultationForm ──→ POST /consultations
                                                                        (invalidates ['consultations'] → grid refetches)

`useCalendarSessions` uses `queryKey: ['consultations', 'range', from, to]`, so the existing `invalidateQueries({ queryKey: ['consultations'] })` in `useCreateConsultation` already refreshes the grid — no extra wiring.

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/.../consultations/dto/consultation-range-query.dto.ts` | Create | `from`/`to`, both `@IsDateString()` |
| `backend/.../consultations/consultations.service.ts` | Modify | `findByRange(therapistId, query)` + span guard + sync map |
| `backend/.../consultations/consultations.controller.ts` | Modify | `@Get('range') findByRange(...)` — **declared before `@Get(':id')`**, same wildcard hazard as `stats` |
| `backend/.../calendar-integration.controller.ts` | Modify | `CALENDAR_RETURN_PATH` constant, L69/L74 |
| `frontend/src/utils/datetime.ts` | Modify | `toChileDayKey(iso)`, `chileMonthGridRange(y,m)` |
| `frontend/src/api/consultations.ts` | Modify | `listConsultationsByRange(from,to)` + `CalendarSession` type |
| `frontend/src/hooks/useCalendarSessions.ts` | Create | Range query hook |
| `frontend/src/hooks/useProfile.ts` | Create | Shared `GET /profile` |
| `frontend/src/pages/CalendarPage.tsx` | Create | Container: month state, grouping, modal wiring |
| `frontend/src/components/calendar/MonthGrid.tsx` | Create | 7-col Tailwind grid + weekday header |
| `frontend/src/components/calendar/DayCell.tsx` | Create | Day number, session chips, `+N más` |
| `frontend/src/components/calendar/DayDetailModal.tsx` | Create | Read-only list + "Agendar sesión" |
| `frontend/src/components/calendar/CalendarSyncBadge.tsx` | Create | Status-only, links to `/security` |
| `frontend/src/components/consultations/ConsultationForm.tsx` | Create | Extracted from `ConsultationsPage` |
| `frontend/src/pages/ConsultationsPage.tsx` | Modify | Consumes `ConsultationForm` |
| `frontend/src/pages/ProfilePage.tsx` | Create | Name, email, password |
| `frontend/src/pages/SecurityPage.tsx` | Create | MFA + history + Google Calendar panel + `?calendar=` banner |
| `frontend/src/pages/SettingsPage.tsx` | Delete | Split |
| `frontend/src/pages/SettingsPage.spec.tsx` | Delete | Split into two specs |
| `frontend/src/pages/{Profile,Security,Calendar}Page.spec.tsx` | Create | One spec per page (repo convention) |
| `frontend/src/App.tsx` | Modify | `calendar`, `profile`, `security` routes + `/settings` → `/security` redirect |
| `frontend/src/components/Layout.tsx` | Modify | navLinks 5 → 7 |

nav order: **Dashboard, Pacientes, Consultas, Calendario, Repositorio, Perfil, Seguridad** — clinical workflow first, Calendario adjacent to Consultas because it reads the same rows, account config last. Icons: `CalendarDays`, `UserCog`, existing `ShieldCheck`.

## Interfaces / Contracts

```ts
// GET /consultations/range?from=<ISO+offset>&to=<ISO+offset>  (JwtAuthGuard, @CurrentUser)
interface CalendarSession {
  id: string;
  groupId: string;
  sessionDate: string;                        // ISO instant
  sessionType: 'IN_PERSON' | 'TELEMED';
  patientId: string;
  patientName: string;                        // patient.fullName
  calendarSync: 'SYNCED' | 'FAILED' | null;   // null = no link / not connected
}
// 200 → CalendarSession[]   400 → to <= from, or span > 62 days
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit (service) | `correctedBy`/`deletedAt` filtering, half-open boundary, span guard, sync map | `consultations.service.spec.ts` |
| Integration | Real Prisma: corrected chain appears once; DST-boundary month (Sep/Apr, Chile) returns edge sessions | `consultations.service.integration.spec.ts` |
| Unit (FE) | Chile day bucketing across DST; grid renders spillover cells; modal is read-only; badge has no controls | `CalendarPage.spec.tsx` |
| Unit (FE) | Perfil and Seguridad each render only their own controls; `?calendar=connected\|error` banner on Seguridad | `ProfilePage.spec.tsx`, `SecurityPage.spec.tsx` |
| Regression | `ConsultationsPage` create flow unchanged after extraction | existing `ConsultationsPage.spec.tsx` |

## Threat Matrix

N/A — no routing (in the shell/process sense), shell command, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The OAuth redirect target is fully server-derived (`FRONTEND_URL` config + a module constant); no user-controlled component reaches it, so no open-redirect surface is introduced.

## Migration / Rollout

No migration, no schema change, no write path. Delivery is `auto-chain`, `stacked-to-main` (as in PRs #92–95), 400-line review budget:

| PR | Scope | Est. | Depends on |
|---|---|---|---|
| 1 | Backend range endpoint: DTO, `findByRange`, controller route ordering, unit + integration specs | ~250 | — |
| 2 | Settings split: `ProfilePage`, `SecurityPage`, `useProfile`, routes + `/settings` redirect, navLinks Perfil/Seguridad, `CALENDAR_RETURN_PATH`, spec split | ~380 | — |
| 3 | Extract `ConsultationForm`; refactor `ConsultationsPage`; adjust its spec (no behavior change) | ~160 | — |
| 4 | Calendar UI: `CalendarPage`, `MonthGrid`, `DayCell`, `DayDetailModal`, `CalendarSyncBadge`, hook, api client, datetime helpers, route + nav link, spec | ~380 | 1, 3 |

PR 2 precedes PR 4 so `Layout.tsx`/`App.tsx` churn happens once and PR 4 only appends one link. If PR 2's spec split pushes it over budget, cut 2a (pages + `useProfile` + routes + nav) / 2b (`CALENDAR_RETURN_PATH` + spec split). Rollback: PRs 3–4 revert frontend-only; PR 1 is additive and read-only and can stay.

## Open Questions

- None blocking.

## Key Learnings

1. `CalendarEventLink` carries no foreign key to `Consultation`, so the sync badge must be resolved by an in-memory `groupId` map rather than a Prisma `include`.
2. Backend `parseDate` resolves date-only strings in server-local time, which makes date-only range params unsafe for a Chile-pinned month grid.
3. Nesting the range query key under `['consultations', 'range', ...]` makes the existing create-mutation invalidation refresh the calendar with no extra wiring.
4. A new single-segment route in `consultations.controller.ts` must be declared before `@Get(':id')` or Nest matches it against that wildcard.
