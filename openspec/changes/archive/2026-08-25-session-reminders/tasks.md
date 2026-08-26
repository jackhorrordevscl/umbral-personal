# Tasks: Session Reminders (therapist in-app + email)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~900-1100 (schema/migrations ~100, notifications ~220, reminders ~280, mail ~50, tests ~350, frontend ~180) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 Notifications → PR 2 Reminders engine → PR 3 Frontend |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main — resolved by user: PR 1 (Notifications) branches off `main`; PR 2/PR 3 each stack on the previous branch and re-target `main` in sequence as prior PRs merge |

Decision needed before apply: No (resolved: stacked-to-main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Notification model + owner-scoped CRUD API | 1 | `cd backend && npx jest src/modules/notifications` | `npx jest --config test/jest-e2e.json notifications.e2e-spec.ts` | Revert notifications module + migration (additive) |
| 2 | Reminders cron: detect/claim/dispatch email+in-app | 2 | `cd backend && npx jest src/modules/reminders` | `REMINDERS_ENABLED=false` disables cron, zero data loss | Revert reminders module, ReminderDispatch migration, mail method, `consultations.service.ts` line |
| 3 | Frontend bell badge + notification list | 3 | `cd frontend && npm test -- --run` | Manual: mark-read updates badge count | Revert frontend files only; API unaffected |

## Phase 1: Notifications — Foundation (PR 1)
- [x] 1.1 `schema.prisma`: add `Notification` model, `NotificationType` enum, `User.notifications` relation.
- [x] 1.2 Migration `prisma/migrations/*_notifications/`: additive `Notification` table.

## Phase 2: Notifications — Core (PR 1)
- [x] 2.1 Create `notifications.service.ts`: `create`, `list`, `unreadCount`, `markRead`, `markAllRead`, all scoped by `userId`.
- [x] 2.2 Create `notifications.controller.ts`: `JwtAuthGuard` + `@CurrentUser()`; `GET /unread-count` declared before `:id` routes.
- [x] 2.3 Create `notifications.module.ts`: exports `NotificationsService`.
- [x] 2.4 `app.module.ts`: register `NotificationsModule`.

## Phase 3: Notifications — Testing (PR 1)
- [x] 3.1 RED `notifications.service.spec.ts`: non-owner mark-read rejected, notification unchanged.
- [x] 3.2 GREEN: `markRead` via `updateMany({ id, userId })`, 0 rows → 404.
- [x] 3.3 RED e2e: therapist B cannot list/mark-read therapist A's notifications.
- [x] 3.4 GREEN: owner-scoped queries pass tenancy e2e.
- [x] 3.5 RED e2e: `GET /unread-count` resolves before `:id` route.
- [x] 3.6 GREEN: confirm controller route order.
- [x] 3.7 Test: unauthenticated request → 401.

## Phase 4: Reminders — Foundation (PR 2)
- [x] 4.1 `package.json`: add `@nestjs/schedule`.
- [x] 4.2 `schema.prisma`: add `ReminderDispatch` + 3 enums, `@@unique([groupId, sessionDate, offsetKind, channel])`; drop `Consultation.reminderSent`.
- [x] 4.3 Migration `prisma/migrations/*_session_reminders/`: additive tables + `DROP COLUMN "reminderSent"`.
- [x] 4.4 Create `reminders.constants.ts`: offsets table, `MAX_LOOKAHEAD_MS`, `SCAN_BATCH_LIMIT`, `RENDER_TIME_ZONE`.
- [x] 4.5 `env.validation.ts`: optional `REMINDERS_ENABLED` (default true).

## Phase 5: Reminders — Core (PR 2)
- [x] 5.1 `mail.service.ts`: add `sendSessionReminderEmail(to, therapistName, patientFullName, when, offsetLabel)`.
- [x] 5.2 Create `reminders.service.ts`: `@Cron` scan (`deletedAt:null`, `correctedBy:null`, `sessionDate` in `(now, now+24h]`); due-ness predicate; claim via `ReminderDispatch.create(PENDING)` catching `P2002`; nearest-offset-only, rest `SKIPPED`; update `SENT`/`FAILED`.
- [x] 5.3 Create `reminders.module.ts`: import `NotificationsModule`, `MailModule`.
- [x] 5.4 `app.module.ts`: `ScheduleModule.forRoot()` + `RemindersModule`.
- [x] 5.5 `consultations.service.ts`: remove `reminderSent` copy-forward (line 230).
- [x] 5.6 `consultations.service.spec.ts`: drop `reminderSent` fixture assertion.

## Phase 6: Reminders — Testing (PR 2)
- [x] 6.1 RED: due-ness at 24h/2h boundaries, past sessions, DST-crossing (fake `now`, table-driven).
- [x] 6.2 GREEN: implement due-ness predicate.
- [x] 6.3 RED: re-arm matrix — date moved → 4 new dispatches; text-only `correct()` → 0.
- [x] 6.4 GREEN: `groupId+sessionDate` key drives re-arm.
- [x] 6.5 RED: `P2002` on claim → skip, email not sent.
- [x] 6.6 GREEN: catch unique-violation, skip silently.
- [x] 6.7 RED: session 10min out — only H2 dispatched, H24 `SKIPPED`, one email/notification not two.
- [x] 6.8 GREEN: nearest-offset-only claim logic.
- [x] 6.9 RED: missing `RESEND_API_KEY` still yields in-app notification; email throw doesn't block in-app.
- [x] 6.10 GREEN: mail null-client fallback; channels dispatch independently.
- [x] 6.11 Integration: scan excludes `deletedAt`/`correctedBy` rows (real Prisma, test DB).
- [x] 6.12 Integration: two consecutive `scan()` runs → exactly one dispatch per tuple.

## Phase 7: Frontend — Notification Surface (PR 3)
- [x] 7.1 Create bell badge component polling `GET /notifications/unread-count`.
- [x] 7.2 Create notification list; mark-read calls `PATCH /notifications/:id/read`.
- [x] 7.3 Wire badge/list into existing layout/nav.
- [x] 7.4 Frontend tests: badge count updates, mark-read updates list state.
