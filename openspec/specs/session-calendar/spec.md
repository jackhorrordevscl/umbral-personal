# session-calendar Specification

## Purpose

Give a therapist a month-view agenda of their own sessions via a read-only, therapist-scoped endpoint (`GET /consultations/range`), plus a day modal that lists that day's sessions read-only and opens the existing clinical scheduling form.

## Requirements

### Requirement: Month Range Read Endpoint

The system MUST expose a read-only endpoint returning the authenticated therapist's sessions within a requested date range, scoped to `therapistId` from the session. It MUST NOT return another therapist's sessions. Both `from` and `to` MUST be ISO instants with an explicit time and offset (for example `2026-09-01T00:00:00-04:00`); a bare date MUST be rejected with `400`. The range MUST be half-open (`from` inclusive, `to` exclusive) and MUST be rejected with `400` when `to` is not after `from` or when it spans more than 62 days. Each session is returned ordered by `sessionDate` ascending with `id`, `groupId`, `sessionDate`, `sessionType`, `patientId`, `patientName`, `calendarSync` and `reminderEmailStatus` (`status`, `deliveredAt`, `openedAt`), and no clinical text. Each returned session MUST include its Google Calendar sync status (`null` when it has no event link) and the status of its latest reminder email (`null` when none was sent). Sessions MUST be ordered by `sessionDate` ascending and expose `id`, `groupId`, `sessionDate`, `sessionType`, `patientId`, `patientName`, `calendarSync` and `reminderEmailStatus` (`status`, `deliveredAt`, `openedAt`), without clinical text.

#### Scenario: Therapist requests a month range

- GIVEN an authenticated therapist with sessions in August 2026
- WHEN they request that range
- THEN the response contains only their own sessions with `sessionDate` inside it

#### Scenario: Cross-therapist isolation

- GIVEN therapist A has sessions and therapist B is authenticated
- WHEN therapist B requests any range
- THEN therapist A's sessions never appear

#### Scenario: Invalid or oversized range is rejected

- GIVEN an authenticated therapist
- WHEN they request a range where `to` is not after `from`, longer than 62 days, or with a bound lacking time and offset
- THEN the response is `400` and no sessions are returned

### Requirement: Session Date Anchoring

The system MUST bucket each session by `sessionDate`, grouped by calendar day in the Chile time zone. It MUST NOT use `nextSessionDate` or any other field to place a session on the grid.

#### Scenario: Session placed by sessionDate

- GIVEN a session with `sessionDate` of August 15
- WHEN the August grid is built
- THEN it appears on August 15, ignoring any `nextSessionDate` note

### Requirement: Current-Version Session Filtering

The system MUST include only the current version of each session, applying `correctedBy: null` and `deletedAt: null` (matching `findByPatient`), and MUST exclude sessions of soft-deleted patients. It MUST NOT show a corrected session twice, a soft-deleted session, or a session cancelled by a treatment discharge (which is stored as soft-deleted).

#### Scenario: Corrected session shown once

- GIVEN a session corrected into an original row and a linked corrected row
- WHEN the month range is requested
- THEN only the corrected (current) row appears

#### Scenario: Soft-deleted session excluded

- GIVEN a session with `deletedAt` set
- WHEN the month range is requested
- THEN that session does not appear

#### Scenario: Sessions cancelled by a discharge disappear from the agenda

- GIVEN a patient's future sessions were cancelled when their treatment was closed with a discharge report
- WHEN the month range covering those sessions is requested
- THEN none of those sessions appear

#### Scenario: Sessions of a deleted patient excluded

- GIVEN a patient was soft-deleted
- WHEN the month range is requested
- THEN that patient's sessions do not appear

### Requirement: Read-Only Day Detail Modal

On clicking a day, the system MUST open a modal listing that day's sessions read-only (patient name, time, session type), with no edit or cancel controls. The modal MUST provide an entry point opening the existing full clinical scheduling form, requiring the same fields already mandatory today (`consultReason`, `intervention`).

#### Scenario: Day with sessions opens read-only list

- GIVEN a day with two sessions
- WHEN the therapist clicks that day
- THEN the modal lists both, with no edit or cancel action

#### Scenario: Scheduling entry point opens the existing clinical form

- GIVEN the day modal is open
- WHEN the therapist selects "Agendar sesión"
- THEN the existing full clinical create form opens, requiring `consultReason` and `intervention`

### Requirement: Scheduling Respects a Closed Treatment

Creating a session for a patient whose treatment is closed (any status other than `ACTIVE`) MUST be rejected with `409` and code `PATIENT_TREATMENT_CLOSED` unless the request explicitly carries `reopenPatient: true`; in that case the system MUST set the treatment back to `ACTIVE` in the same transaction and record a `TREATMENT_REOPENED` audit entry. The form MUST ask the therapist to confirm the reopening before resending the request.

#### Scenario: Scheduling for a closed treatment without confirmation

- GIVEN a patient whose treatment was closed by a discharge
- WHEN the therapist creates a session without confirming the reopening
- THEN the response is `409` with code `PATIENT_TREATMENT_CLOSED` and no session is created

#### Scenario: Correcting a future session of a closed treatment

- GIVEN a patient whose treatment is closed
- WHEN the therapist corrects a session so that its resulting date is in the future
- THEN the response is `409` with code `PATIENT_TREATMENT_CLOSED` and the session is not corrected

#### Scenario: Correcting a future session of a closed treatment

- GIVEN a patient whose treatment is closed
- WHEN the therapist corrects a session so that its resulting date is in the future
- THEN the response is `409` with code `PATIENT_TREATMENT_CLOSED` and the session is not corrected

#### Scenario: Confirmed reopening

- GIVEN the same closed treatment and the therapist confirms the reopening
- WHEN the session is created with `reopenPatient: true`
- THEN the treatment becomes `ACTIVE`, the session is created, and the reopening is audited

### Requirement: Google Calendar Status Badge

The calendar view MUST show a read-only Google Calendar status badge from `GET /calendar-integration/status`, linking to the security section, without connect/disconnect controls. While the status is loading or unavailable, the badge MUST say so instead of showing a connection state.

#### Scenario: Badge reflects connected status

- GIVEN the therapist's Google Calendar connection is active
- WHEN the calendar view loads
- THEN the badge shows connected status with no inline control

#### Scenario: Badge links to security section

- GIVEN the badge is visible
- WHEN the therapist clicks it
- THEN they are taken to the security section
