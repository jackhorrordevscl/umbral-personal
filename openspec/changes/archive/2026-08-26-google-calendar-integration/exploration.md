# Exploration: google-calendar-integration (in-app notifications, therapist email reminders, Google Calendar OAuth sync, patient calendar-invite email)

## Current State

- **Consultation model** (`backend/prisma/schema.prisma:153-193`): `sessionDate` (required, can be a future date — consultations already represent scheduled/upcoming sessions, not just past notes), `nextSessionDate` (optional forward-pointer, not itself reminder-bearing), `scheduledAt`, and a **dormant `reminderSent` boolean** that is never set true or read anywhere except copied forward on `correct()` (`backend/src/modules/consultations/consultations.service.ts:230`) — clear pre-existing scaffolding for this exact feature, never wired up.
- `Patient.email` (`schema.prisma:113`) is optional and validated with `@ValidateIf`/`@IsEmail` allowing `""` (`backend/src/modules/patients/dto/create-patient.dto.ts:31-38`) — patients frequently have no email on file; the invite-email feature must handle that gracefully (skip + surface to therapist), it's not guaranteed.
- `User.email` is required/unique, already used everywhere.
- **Mail infra**: `backend/src/modules/mail/mail.service.ts` wraps `resend`, one method per email type, hardcoded Spanish HTML, fire-and-forget (log on failure, never throws), no-op with a warning if `RESEND_API_KEY` is unset. Right service to extend; no templating engine, no attachment/ICS support today.
- **Encryption precedent**: `backend/src/modules/documents/document-encryption.service.ts` — AES-256-GCM, key from `DOCUMENT_ENCRYPTION_KEY` env var, `[IV][authTag][ciphertext]` format. This is the pattern to reuse for OAuth refresh-token storage. By contrast, `User.mfaSecret` is stored in **plaintext** (confirmed via grep, `auth.service.ts:637`) — a pre-existing gap, not a pattern to copy for a new external credential.
- **No scheduler/queue/OAuth/ICS infra exists**: `backend/package.json` has no `@nestjs/schedule`, no BullMQ, no `googleapis`, no `ics`. `docker-compose.yml` only runs Postgres, no Redis.
- **No in-app notification pattern in frontend**: no toast/notification library, no matches for `toast|notification` anywhere under `frontend/src`. Fully net-new.
- **No OAuth code anywhere** — this would be the first third-party OAuth integration in the codebase.

## Affected Areas

- `backend/prisma/schema.prisma` — new models (`GoogleCalendarConnection`, `InAppNotification`/`ReminderLog`); `reminderSent` boolean is insufficient as-is (can't distinguish email-sent vs in-app-sent vs synced) and likely needs to become a richer state.
- `backend/src/modules/mail/mail.service.ts` — new `sendSessionReminderEmail` / `sendPatientCalendarInviteEmail` methods.
- `backend/src/modules/consultations/` — natural trigger points for reminder scheduling and calendar-sync-on-write.
- New `backend/src/modules/calendar-integration/` (OAuth authorize/callback/disconnect, encrypted token storage, Google Calendar client) and `backend/src/modules/reminders/` (scheduled scan of upcoming `sessionDate`).
- `backend/src/app.module.ts` — wire `@nestjs/schedule` or a queue module.
- `frontend/src/` — net-new in-app notification UI (polling hook + inbox/badge), plus a "Connect Google Calendar" flow, most naturally surfaced from `SettingsPage.tsx` (already touched on this branch).
- `docs/registro-actividades-tratamiento.md` and `docs/clausula-transferencia-internacional.md` — MUST gain new rows/clauses for Google as a new processor and for the patient invite email, per this project's own established compliance-documentation discipline.
- `.env`/`docker-compose.yml` — new env vars (`GOOGLE_CLIENT_ID/SECRET`, token-encryption key); Redis only if a queue-based approach is chosen.

## Researched External Constraints

- **Google OAuth**: authorization-code flow with `access_type=offline` for a refresh token; scope should be minimal — `calendar.events` (per-event create/update/delete), not the broad `calendar` scope. Refresh tokens can be revoked by the user or invalidated after 6 months unused; sync jobs must handle `invalid_grant`/401 by marking the connection disconnected and notifying the therapist, not crash-looping.
- **"Full sync" investigated**: true two-way sync (Google's `events.watch` + `syncToken` reconciliation) would let an external, unaudited edit in Google Calendar (e.g., drag-to-reschedule) silently mutate `Consultation.sessionDate`, bypassing Umbral's existing append-only/audited correction model (`ConsultationHistory`, `correctsId`). That's a real integrity conflict. **Recommendation: push-only (Umbral → Google) sync** — "full" in the sense of create/update-on-correction/delete-on-cancel all propagating, but one-directional; true two-way sync should be a separate, explicitly-decided future change.
- **ICS**: RFC 5545 `VEVENT` as a `.ics` attachment (`text/calendar`), or a zero-backend "Add to Google Calendar" template link — the latter needs no patient-side OAuth, matching the requirement exactly.

## Compliance Research

- **Applicable legal framework, grounded in-repo (not assumed)**: `docs/registro-actividades-tratamiento.md` explicitly cites **Ley 21.719** (Chile's data-protection law) plus **Ley 20.584** (health-record custody, 15-year retention) and **Ley 19.628** (security obligations) as the governing framework, from a real prior legal/technical audit (issue #29). No GDPR/HIPAA reference exists for Umbral itself anywhere in the repo (Resend's own DPA cites GDPR/CCPA as ITS compliance surface as a vendor, not Umbral's). **This is the framework to design against.**
- **Patient invite email**: sending patients their own appointment time to their own registered email is likely fine (same "contractual necessity" basis the RAT already applies to therapist account emails) — but subject line/sender name is a separate leak vector (shared inbox, lock-screen preview). Recommend a generic subject/sender ("Recordatorio de cita — Umbral", no "psicología"/diagnosis content) and omit clinical detail from the invite body.
- **Google Calendar sync is the real compliance gap**: it replicates patient name + appointment timing (health-adjacent data) to a brand-new third-party processor (Google) with **zero existing DPA evidence** in `docs/evidencia-compliance/` and **zero consent-clause coverage** in `docs/clausula-transferencia-internacional.md` (which today only covers Supabase/Backblaze). Concrete minimization option, directly analogous to how the project already handles the Backblaze-encryption case: default the synced event to patient initials/code (not full name) with a deep link back to Umbral in the description, and treat "sync full patient name" as an explicit therapist opt-in requiring a consent-clause update — not the default. This should go to the user/product owner as an **open decision**, exactly how the RAT itself flags the unresolved Backblaze/Chile transfer question ("no está resuelto ni evaluado legalmente").
- **OAuth token storage**: reuse the `DocumentEncryptionService` AES-256-GCM pattern (not the plaintext `mfaSecret` anti-pattern) for refresh tokens; minimize scope to `calendar.events`; support explicit revocation (call Google's revoke endpoint + delete stored token) on "disconnect."

## Approaches

1. **Phased, schedule-based rollout** (in-app notifications + reminders → patient ICS invite → Google OAuth sync last) using `@nestjs/schedule`, no new infra.
   - Pros: no new infra dependency; each slice independently shippable under the existing ~400-line PR-budget discipline; compliance work scoped per-slice.
   - Cons: full feature lands later; needs one shared "upcoming session" query reused by all three triggers.
   - Effort: Medium per slice, High in aggregate.
2. **Queue-based (BullMQ + Redis), all four features built together.**
   - Pros: better retry/backoff for flaky Google API calls and emails; standard pattern.
   - Cons: adds a new infra dependency (Redis) to a stack that currently only runs Postgres; naturally wants to land as one large PR, conflicting with this repo's established chained-PR/budget discipline; no stated scale justifies it yet.
   - Effort: High.
3. **Ship only notifications + reminders now; defer Google OAuth sync and patient ICS to a future change** pending legal review.
   - Pros: lowest risk, avoids committing before the unresolved legal question is answered.
   - Cons: does not satisfy the user's full stated scope.
   - Effort: Low for the shipped subset.

## Recommendation

Approach 1, sequenced: (1) in-app notifications + therapist email reminders (finally wiring the dormant `reminderSent` field, `@nestjs/schedule`-driven), (2) patient calendar-invite email (ICS/"Add to Google Calendar" link, content-minimized), (3) Google Calendar OAuth sync, push-only, `calendar.events` scope, `DocumentEncryptionService`-style token encryption — built last, and only after the user/product owner explicitly decides the default event-content minimization (initials/code vs. full name), since that decision materially changes the design and this project's own precedent (RAT) treats such transfer questions as non-engineering decisions.

## Risks

- Google Calendar sync with full patient names by default would create a real, currently undocumented compliance gap (new processor, new data category) — needs an explicit decision before spec'ing that slice.
- No legal counsel has evaluated Ley 21.719 applicability to this specific transfer; flagged as open, same posture as the existing Backblaze/Chile gap in the RAT.
- True two-way sync would let unaudited external edits mutate `Consultation.sessionDate`, conflicting with the append-only/audited correction model — push-only avoids this but must be an explicit decision, not an assumption.
- OAuth refresh-token revocation/expiry handling is new territory for this codebase; needs graceful degrade + therapist notification, not silent failure or crash-loop.
- `Patient.email` is optional/frequently blank — the invite-email feature needs an explicit no-op/warn path, not a hard failure.
- The dormant `reminderSent` boolean is too coarse (can't distinguish email vs in-app vs synced) — likely needs a richer schema (separate fields or a `ReminderLog`/`NotificationLog` table) rather than reuse as-is.
- No queue/cron infra exists today; schedule-based v1 is an acceptable tradeoff but may need to migrate to a queue if reminder/API-retry volume grows.

## Ready for Proposal

Yes for slices 1-2 (in-app notifications, therapist email reminders, patient calendar-invite email) — no unresolved legal blocker, proceed to `sdd-propose`/`sdd-spec`.

For slice 3 (Google Calendar OAuth sync): recommend the orchestrator surface the open compliance decision (default event-content minimization; Google as an undocumented new sub-processor) to the user before writing that slice's spec. The technical approach itself (push-only, minimal scope, `DocumentEncryptionService`-pattern token encryption) is otherwise ready to specify once that decision is made.
