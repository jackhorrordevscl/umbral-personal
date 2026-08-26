# Proposal: Session Reminders (therapist in-app + email)

## Intent

`Consultation.sessionDate` already stores every scheduled session, but Umbral never tells the therapist one is coming. `Consultation.reminderSent` has existed since the original schema as dead code — only copied forward in `correct()`, never set, never read. Therapists rely on memory or an external calendar; a missed session is a direct service failure. The data is ready; the delivery mechanism does not exist.

Slice 1 of 3 (exploration: `sdd/google-calendar-integration/explore`). Deliberately the slice with no new third-party data flow and no unresolved legal question — therapist account email via Resend is already covered by RAT row 4.

## Scope

### In Scope
- Scheduled job detecting sessions ~24h and ~2h ahead of `sessionDate`.
- Therapist **email** reminder: new `MailService` method (Resend, Spanish HTML, fire-and-forget — existing conventions).
- Therapist **in-app** notification: persistence, read/unread state, therapist-scoped API, net-new frontend surface.
- Per-(session, offset, channel) dispatch tracking replacing the too-coarse `reminderSent` boolean.
- `@nestjs/schedule` — the project's first scheduling infrastructure.

### Out of Scope
- **Patient** notifications, including ICS/calendar-invite email — slice 2 `patient-calendar-invite`.
- **Google Calendar** OAuth/token storage/event push — slice 3 `google-calendar-sync`.
- Two-way sync — declined for the whole family; breaks the append-only `ConsultationHistory`/`correctsId` audit model.
- Configurable offsets, quiet hours, digest mode, SMS/WhatsApp/push.
- BullMQ/Redis or any new infrastructure service.
- RAT/consent-clause updates — no new processor or data category.

## Capabilities

### New Capabilities
- `session-reminders`: which upcoming sessions are reminded, at which offsets, on which channels, with exactly-once guarantees.
- `in-app-notifications`: therapist-scoped notification records, read/unread lifecycle, retrieval API and UI. Generic enough for slices 2–3 to emit into.

### Modified Capabilities
- None. `openspec/specs/` has no baseline; both above are the first specs.

## Business Rules

| Rule | Value |
|---|---|
| Audience | Therapist only (`therapistId` → `User.email`) |
| Offsets | 24h **and** 2h before `sessionDate`, independent firings |
| Channels | In-app **and** email, both at each offset |
| Idempotency | At most one delivery per (consultation, offset, channel) |
| Late-created sessions | If an offset has already elapsed at creation/detection time, fire it immediately on the next tick rather than skipping it |
| Corrected sessions | `correct()` moving `sessionDate` re-arms **all** offsets for the new date, including ones already sent for the old date — a rescheduled session is treated as newly due |
| Cancelled/deleted sessions | No dedicated cancellation state exists; a soft-deleted consultation (`deletedAt` set) must be excluded from the scan query, same filter (`deletedAt: null`) used elsewhere in `consultations.service.ts` |
| Email content | Reminder email includes the patient's full name — therapist's own inbox about their own patient, simpler legal basis than the third-party Google Calendar case (slice 3) |

## Approach

In-process cron polling a bounded lookahead window, not per-session timers. Chosen over BullMQ/Redis because `docker-compose.yml` runs Postgres only; Redis is real operational cost with no stated volume need. Migration to a queue stays open.

A new backend module owns detection and dispatch; `MailService` gains one method per its one-method-per-email-type convention; a notification model plus therapist-scoped endpoints back the new frontend surface. Exact schema shape (dispatch-log table vs. per-channel columns; drop vs. keep `reminderSent`) is an `sdd-design` decision.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `backend/prisma/schema.prisma` | Modified | Notification model, dispatch state, `reminderSent` resolved |
| `backend/src/modules/mail/mail.service.ts` | Modified | New `sendSessionReminderEmail` |
| `backend/src/modules/reminders/` | New | Cron scan + dispatch |
| `backend/src/modules/notifications/` | New | Persistence + therapist-scoped API |
| `backend/src/app.module.ts` | Modified | `ScheduleModule.forRoot()` + new modules |
| `backend/src/modules/consultations/` | Modified | Re-evaluate on `create`/`correct` |
| `frontend/src/` | New | Notification badge/list; no toast library to extend |
| `backend/package.json` | Modified | `@nestjs/schedule` |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Duplicate sends (multi-instance / overlapping ticks) | Med | Persisted dispatch record; design states the atomicity guarantee |
| Timezone/DST drift breaks "24h before" | Med | Compute from UTC `sessionDate`; spec fixes rendering timezone |
| Sessions created <24h or <2h ahead get no reminder | Low (decided) | Fire the elapsed offset immediately on next tick instead of skipping |
| Session rescheduled via `correct()` | Med | Re-arm all offsets (including already-sent) for the new date |
| Session soft-deleted (no cancellation state exists) | Low (decided) | Scan query filters `deletedAt: null`, consistent with existing service queries |
| Process down at tick time | Low | Poll a window, not an instant, so late ticks still catch due items |
| Notifications grow unbounded | Low | Retention/pagination at design; not a launch blocker |

## Rollback Plan

Additive and isolated. (1) Remove `ScheduleModule.forRoot()` or disable via env flag — reminders stop immediately, zero data loss. (2) Revert frontend surface. (3) Revert `MailService` method. (4) Reverse the Prisma migration; new tables/columns are additive, so the down-migration drops them without touching `Consultation` clinical fields. No existing behavior is modified, so stopping at step 1 is safe on its own.

## Dependencies

- `@nestjs/schedule` (npm only, no runtime service).
- `RESEND_API_KEY` already configured; absent key degrades to a logged skip, matching current `MailService` behavior.
- No dependency on slices 2 or 3.

## Success Criteria

- [ ] A session 24h out yields exactly one therapist email and one in-app notification.
- [ ] The same session at 2h out yields a second, distinct email + notification.
- [ ] Re-running the scan never re-sends an already-dispatched (session, offset, channel).
- [ ] A therapist sees only their own notifications and can mark them read.
- [ ] Missing `RESEND_API_KEY` still produces in-app notifications.
- [ ] `Consultation.reminderSent` is no longer dead code — used or removed.
- [ ] No new external processor; no RAT/consent-clause change required.

## Open Questions

All resolved by explicit product decision; see Business Rules and Risks tables above. None remain blocking for `sdd-spec`.

1. ~~Session created inside an offset window: skip or fire immediately?~~ → Fire immediately.
2. ~~Does `correct()` re-arm already-sent offsets?~~ → Yes, all offsets re-arm on reschedule.
3. ~~Is there a cancelled/no-show state?~~ → No such state exists in the schema; `deletedAt` (soft-delete) is the closest analog and must gate the scan query.
4. ~~Patient name vs. minimized content in the email?~~ → Full patient name (therapist's own inbox, own patient).
