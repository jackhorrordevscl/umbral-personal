# Proposal: Session Calendar View + Settings Split

## Intent

- Therapists cannot see their own agenda. Sessions are only reachable per patient (`GET /consultations/patient/:patientId`); no therapist-wide list endpoint exists, so "what do I have this month" is unanswerable in-product.
- `SettingsPage.tsx` (628 lines) mixes account identity, credentials, MFA and the Google Calendar connection behind one `Seguridad` nav link.

## Scope

### In Scope
- `Calendario` nav section: month grid of the authenticated therapist's sessions, past and future, month-navigable.
- New backend range-read endpoint for the therapist's sessions (none exists today).
- Day modal: read-only list of that day's sessions + entry point to schedule a new one, reusing `components/ui/Modal.tsx` and the create form of `ConsultationsPage.tsx`.
- Google Calendar status badge in Calendario, linking to Seguridad (status only, no controls).
- Split `SettingsPage.tsx` into `Perfil` (name, email, password) and `Seguridad` (MFA, Google Calendar panel, future account security), each with its own nav link and route.

### Out of Scope
- Week/day views.
- Editing or cancelling sessions from the modal (stays in Consultas).
- Reading from the Google Calendar API — the integration is push-only by spec.
- Historical name snapshots per consultation; `Consultation.therapistId` is a live FK to `User.id`, which is the intended behaviour.
- Duplicating the connect/disconnect panel in Calendario.

## Capabilities

### New Capabilities
- `session-calendar`: month agenda, day detail, scheduling entry point, sync indicator.
- `account-settings`: profile vs security section boundaries and their nav/route contract.

### Modified Capabilities
- None.

## Approach

Read from Umbral's own `Consultation` table via Prisma, filtered `therapistId` + `correctedBy: null` + `deletedAt: null` (the current-version filter already used by `findByPatient`). Join `CalendarEventLink` on `groupId` for the badge. Build the grid with Tailwind and `Intl.DateTimeFormat({ timeZone: 'America/Santiago' })`, matching `utils/datetime.ts`; no calendar/date dependency exists in `frontend/package.json` and none is proposed.

**Resolved during proposal review (user decision):**
- **Date anchor**: the grid buckets sessions by `sessionDate` — the field the current form actually edits. `nextSessionDate` (a note on a closed consultation, not a session row of its own) is explicitly not used for calendar placement; the dashboard's "próximas" counter keeps its current behavior and is not migrated by this change.
- **Scheduling entry point**: the modal's "agendar sesión nueva" button opens the existing full clinical create form from `ConsultationsPage.tsx` unchanged (patient + date/time + `consultReason` + `intervention`). No lightweight-booking concept is introduced; this keeps the backend and DTO untouched for this flow.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/modules/consultations/` | Modified | Range-read endpoint + service query |
| `frontend/src/pages/CalendarPage.tsx` | New | Month grid + day modal |
| `frontend/src/pages/SettingsPage.tsx` | Modified | Split into Perfil / Seguridad |
| `frontend/src/components/Layout.tsx` | Modified | navLinks: 5 → 7 |
| `frontend/src/App.tsx` | Modified | New routes |
| `backend/src/modules/calendar-integration/calendar-integration.controller.ts` | Modified | OAuth redirect hardcodes `/settings?calendar=` (L69, L74) |
| `frontend/src/pages/SettingsPage.spec.tsx` | Modified | Splits with the page |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Date anchor ambiguity: `sessionDate` vs `scheduledAt` vs `nextSessionDate` (`getStats` counts "upcoming" by `nextSessionDate`) | Resolved | Anchored on `sessionDate`; dashboard counter left as-is, out of scope |
| Scheduling requires `consultReason` + `intervention` (required in DTO and UI), so booking = writing a clinical note | Resolved | Modal opens the existing full clinical form as-is, no new booking concept |
| Timezone drift: backend `parseDate` uses server-local noon; grid must bucket in Chile time | Med | Range boundaries and bucketing pinned to `America/Santiago` |
| Correction chain duplicates rows in the grid | Med | Reuse `correctedBy: null` filter |
| Broken OAuth return after the split | Med | Keep `/settings` resolving to Seguridad |
| Combined scope exceeds the 400-line review budget | High | Auto-chain: settings split, backend endpoint, calendar UI |

## Rollback Plan

Frontend-only revert restores `SettingsPage` and drops the nav entries; the backend endpoint is additive and read-only, so it can stay or be reverted independently. No migration, no schema change, no data written.

## Dependencies

- None. No new package; existing `calendar-integration` status endpoint reused as-is.

## Success Criteria

- [ ] Therapist opens `Calendario` and sees every own session of any month, past or future.
- [ ] Corrected sessions appear once, soft-deleted ones not at all.
- [ ] Clicking a day opens a modal listing that day's sessions read-only, with a scheduling entry point and no edit/cancel control.
- [ ] `Perfil` and `Seguridad` are separate nav sections with no duplicated control.
- [ ] Google OAuth return still lands on Seguridad with its status feedback.
