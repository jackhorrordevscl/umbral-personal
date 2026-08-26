# Proposal: Google Calendar Sync (push-only, therapist account)

Closes GitHub issue **#78** — "Vincular sesiones/consultas con Google Calendar del terapeuta".

## Intent

Umbral now reminds therapists of upcoming sessions (`session-reminders`, archived), but every session still lives only inside Umbral. Therapists run their day from Google Calendar, so Umbral sessions are invisible next to the rest of their agenda and get double-booked or manually re-typed. Slice 3 of the shared exploration (`sdd/google-calendar-integration/explore`) — the last remaining slice, and the only one that sends data to a new third-party processor.

## Scope

### In Scope

- OAuth 2.0 authorization-code connect/disconnect for the therapist's own Google account, scope `calendar.events`, `access_type=offline`.
- Refresh token stored AES-256-GCM encrypted, reusing the `DocumentEncryptionService` pattern (never plaintext — not the `mfaSecret` precedent).
- Push-only propagation: create on consultation create, update on `correct()` reschedule, delete on soft-delete.
- Minimized event content by default and by rule: patient initials + short code, generic title, deep link back to Umbral. No RUT, no clinical fields.
- Bounded one-time push of already-scheduled future sessions at connect time.
- Revocation/expiry degrade path: `invalid_grant`/401 marks the connection disconnected, emits an in-app notification, and stops syncing — no crash-loop, no silent failure.
- `docs/registro-actividades-tratamiento.md`: Google added as a processor (new data flow, even minimized).

### Out of Scope

- **Full patient name in the event** — deferred. Requires a `docs/clausula-transferencia-internacional.md` update and a legal call, not engineering; v1 ships minimized-only, and the opt-in is additive later.
- Two-way sync (`events.watch`/`syncToken`) — declined for the whole family; external edits would bypass the append-only `ConsultationHistory`/`correctsId` audit model.
- Patient-facing ICS/calendar invite — separate change.
- Per-session sync toggle (connection is account-level on/off), other providers (Outlook/Apple/CalDAV), BullMQ/Redis retry infrastructure.

## Capabilities

### New Capabilities

- `calendar-sync`: therapist Google connection lifecycle, encrypted token custody, push-only event propagation, content minimization, and degraded-connection behavior.

### Modified Capabilities

- None. Disconnection alerts emit into the existing `notifications` capability, which already specifies generic therapist-scoped emission; no requirement changes there or in `reminders`.

## Business Rules

| Rule | Value |
|---|---|
| Granularity | One connection per therapist account, on/off; never per session |
| Direction | Push-only Umbral → Google; a Google-side edit never mutates `Consultation` |
| OAuth scope | `calendar.events` only, offline access |
| Event content | Patient initials + short code + Umbral deep link; generic title; no RUT, no clinical text |
| Full name | Not available in v1, under any setting |
| Event identity | Mapping keyed by `Consultation.groupId`, so a `correct()` version updates the same Google event instead of duplicating |
| Cancellation | No cancelled state exists; `deletedAt` set → delete the Google event |
| Disconnect | Call Google's revoke endpoint, then delete the stored token |
| Broken grant | Mark disconnected + notify therapist; stop, do not retry indefinitely |
| Patient code | `Patient` has no code column; initials derive from `fullName` and the code from a non-reversible short form — `rut` is never used |

## Approach

A new `backend/src/modules/calendar-integration/` module owns the OAuth handshake, encrypted token custody, and a thin Google Calendar client. `ConsultationsService` write paths emit sync intents; sync failures are logged and never block the clinical write. Connection UI lives in `SettingsPage.tsx`, matching the existing account-settings surface.

Push-only over two-way is the deliberate integrity choice from the exploration: Umbral stays the single audited source of truth for `sessionDate`.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `backend/prisma/schema.prisma` | Modified | `GoogleCalendarConnection` + event-mapping model |
| `backend/src/modules/calendar-integration/` | New | OAuth, token custody, Google client, sync service |
| `backend/src/modules/consultations/` | Modified | Emit sync on create / `correct()` / soft-delete |
| `backend/src/app.module.ts` | Modified | Wire the new module |
| `frontend/src/pages/SettingsPage.tsx` | Modified | Connect / disconnect / status |
| `docs/registro-actividades-tratamiento.md` | Modified | Google as processor |
| `backend/package.json`, `.env` | Modified | Google client lib; `GOOGLE_CLIENT_ID/SECRET`, redirect URI |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Google OAuth app verification required for a sensitive Calendar scope before general availability | High | Treat as a launch dependency; test-user mode works during development |
| Refresh token leak = access to a therapist's whole calendar | Low | AES-256-GCM at rest, `calendar.events` scope only, revoke on disconnect |
| Revoked/expired grant causes a retry loop | Med | Disconnect + notify + stop; explicit non-retry rule |
| Google outage/latency blocks a clinical write | Med | Sync is non-blocking and failure-tolerant by design |
| Undocumented third-party transfer (Ley 21.719 / 20.584 / 19.628) | Med | Minimized content by rule + RAT update in the same change; full name stays out |
| Event/version drift after repeated `correct()` | Med | `groupId`-keyed mapping, not per-row |
| PR exceeds the review budget | Med | Chain: schema+OAuth+tokens → sync propagation → frontend+docs |

## Rollback Plan

Additive and isolated. (1) Unset `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or disable the module — sync stops immediately, existing Google events remain but nothing new is written; zero clinical data loss. (2) Revert the `SettingsPage.tsx` surface. (3) Revert the `ConsultationsService` emission points; all clinical writes behave exactly as before. (4) Reverse the Prisma migration — new tables are additive and drop without touching `Consultation` or `Patient`. Stopping at step 1 is safe on its own. Revoking already-issued Google grants is a therapist-side action Umbral also exposes via disconnect.

## Dependencies

- Google Cloud project, OAuth client credentials, and consent-screen configuration/verification for the `calendar.events` sensitive scope.
- Existing `DocumentEncryptionService` AES-256-GCM pattern and its key-management convention.
- No dependency on the deferred patient-invite slice.

## Success Criteria

- [ ] A therapist connects Google from Settings and sees connection status; disconnect revokes and deletes the stored token.
- [ ] Creating a session pushes an event containing initials + code + Umbral link, and no RUT or clinical text.
- [ ] `correct()` on `sessionDate` updates the same Google event; soft-delete removes it.
- [ ] A revoked grant marks the connection disconnected and notifies the therapist once, without retry loops.
- [ ] The refresh token is unreadable at rest in the database.
- [ ] Every clinical write still succeeds while the Google API is unavailable.
- [ ] The RAT documents Google as a processor before release.

## Confirmed Decisions

- **Backfill**: connect-time push of already-scheduled future sessions is in scope, bounded to a window (exact window size — e.g. 90 days — is an `sdd-design` decision).
- **Disconnection alert**: in-app notification only, reusing the existing `notifications` capability. No email channel.
- **Calendar target**: events are written to the therapist's primary Google Calendar. No calendar picker in v1.
- **Session type**: `Consultation.sessionType` (presencial/otro) does NOT appear in the event. Content stays minimized to initials + code + Umbral link.

## Open Questions

Non-blocking for `sdd-spec`.

1. Exact patient-code derivation (initials + which non-reversible short form) — an `sdd-design` decision; the rule that `rut` is never used is fixed here.
