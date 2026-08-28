# session-calendar Specification

## Purpose

Give a therapist a month-view agenda of their own sessions via a new read-only, therapist-scoped endpoint, plus a read-only day modal that opens the existing clinical scheduling form.

## Requirements

### Requirement: Month Range Read Endpoint

The system MUST expose a read-only endpoint returning the authenticated therapist's sessions within a requested date range, scoped to `therapistId` from the session. It MUST NOT return another therapist's sessions.

#### Scenario: Therapist requests a month range

- GIVEN an authenticated therapist with sessions in August 2026
- WHEN they request that range
- THEN the response contains only their own sessions with `sessionDate` inside it

#### Scenario: Cross-therapist isolation

- GIVEN therapist A has sessions and therapist B is authenticated
- WHEN therapist B requests any range
- THEN therapist A's sessions never appear

### Requirement: Session Date Anchoring

The system MUST bucket each session by `sessionDate`. It MUST NOT use `nextSessionDate` or any other field to place a session on the grid.

#### Scenario: Session placed by sessionDate

- GIVEN a session with `sessionDate` of August 15
- WHEN the August grid is built
- THEN it appears on August 15, ignoring any `nextSessionDate` note

### Requirement: Current-Version Session Filtering

The system MUST include only the current version of each session, applying `correctedBy: null` and `deletedAt: null` (matching `findByPatient`). It MUST NOT show a corrected session twice or a soft-deleted session.

#### Scenario: Corrected session shown once

- GIVEN a session corrected into an original row and a linked corrected row
- WHEN the month range is requested
- THEN only the corrected (current) row appears

#### Scenario: Soft-deleted session excluded

- GIVEN a session with `deletedAt` set
- WHEN the month range is requested
- THEN that session does not appear

### Requirement: Read-Only Day Detail Modal

On clicking a day, the system MUST open a modal listing that day's sessions read-only, with no edit or cancel controls. The modal MUST provide an entry point opening the existing full clinical scheduling form, requiring the same fields already mandatory today (`consultReason`, `intervention`).

#### Scenario: Day with sessions opens read-only list

- GIVEN a day with two sessions
- WHEN the therapist clicks that day
- THEN the modal lists both, with no edit or cancel action

#### Scenario: Scheduling entry point opens the existing clinical form

- GIVEN the day modal is open
- WHEN the therapist selects "schedule new session"
- THEN the existing full clinical create form opens, requiring `consultReason` and `intervention`

### Requirement: Google Calendar Status Badge

The calendar view MUST show a read-only Google Calendar status badge from `GET /calendar-integration/status`, linking to the security section, without connect/disconnect controls.

#### Scenario: Badge reflects connected status

- GIVEN the therapist's Google Calendar connection is active
- WHEN the calendar view loads
- THEN the badge shows connected status with no inline control

#### Scenario: Badge links to security section

- GIVEN the badge is visible
- WHEN the therapist clicks it
- THEN they are taken to the security section
