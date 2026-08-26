# Spec: in-app-notifications (New Capability)

## Purpose

Therapist-scoped notification records with a read/unread lifecycle and an authenticated, owner-only retrieval API, generic enough to be emitted into by future reminder-producing capabilities.

## Requirements

### Requirement: Therapist-Scoped Persistence

Every notification MUST be persisted with an owning `therapistId` and MUST be visible or mutable only by that therapist.

#### Scenario: Notification created for the owning therapist

- GIVEN a session reminder fires for therapist A
- WHEN the notification is persisted
- THEN it is associated only with therapist A

### Requirement: Authorized, Owner-Scoped Retrieval

The retrieval API MUST require authentication (same guard convention as `patients`/`consultations` modules) and MUST return only notifications owned by the requesting therapist.

#### Scenario: Therapist B cannot see therapist A's notifications

- GIVEN therapist A has notifications and therapist B is authenticated
- WHEN therapist B calls the list endpoint
- THEN the response contains none of therapist A's notifications

#### Scenario: Unauthenticated request is rejected

- GIVEN no valid JWT is present
- WHEN the list endpoint is called
- THEN the request is rejected with 401

### Requirement: Read/Unread Lifecycle Scoped to Owner

Notifications MUST start unread. Only the owning therapist MUST be able to mark a notification read.

#### Scenario: Owner marks a notification read

- GIVEN an unread notification owned by therapist A
- WHEN therapist A marks it read
- THEN its state becomes read and persists across subsequent fetches

#### Scenario: Non-owner cannot mark it read

- GIVEN a notification owned by therapist A
- WHEN therapist B attempts to mark it read
- THEN the request is rejected and the notification remains unchanged
