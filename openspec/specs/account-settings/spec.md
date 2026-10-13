# account-settings Specification

## Purpose

Split account settings into `Perfil` (identity, public profile, credentials and availability) and `Seguridad` (MFA, security history, invitations and Google Calendar connection), each with its own nav entry and route, keeping the Google OAuth return flow working.

## Requirements

### Requirement: Profile Section Scope

`Perfil` (route `/profile`) MUST contain the therapist's identity and profile data: profile photo, name, public profile (specialty, bio, website), professional data (RUT and professional registration), email change, password change, the public self-scheduling link, and the weekly schedule and blockout editors. It MUST NOT include MFA or Google Calendar controls.

#### Scenario: Perfil shows identity and profile fields only

- GIVEN the therapist opens `Perfil`
- WHEN the page renders
- THEN it shows photo, name, public profile, professional data, email, password, self-scheduling link, weekly schedule and blockout controls, and no MFA or Google Calendar control

### Requirement: Security Section Scope

`Seguridad` (route `/security`) MUST contain MFA management, the MFA security history (when entries exist), and the full Google Calendar panel (connect, disconnect, status). It MUST also show the invitation-code generator when the profile reports `canInvite`. The Google Calendar panel MUST NOT be duplicated elsewhere, including the calendar view.

#### Scenario: Seguridad shows MFA and Google Calendar panel

- GIVEN the therapist opens `Seguridad`
- WHEN the page renders
- THEN it shows MFA controls and the full Google Calendar connect/disconnect panel

#### Scenario: Invitation generator only for allowed accounts

- GIVEN a therapist whose profile does not report `canInvite`
- WHEN `Seguridad` renders
- THEN no invitation-code generator is shown

#### Scenario: No duplicated Google Calendar controls

- GIVEN the calendar view shows a status badge
- WHEN the therapist looks for connect/disconnect controls
- THEN those exist only in `Seguridad`, never in the calendar view

### Requirement: Separate Navigation and Routes

`Perfil` and `Seguridad` MUST be two distinct navigation entries, each with its own route. They MUST NOT merge back into one settings page or route. The legacy `/settings` path MUST redirect to `/security`.

#### Scenario: Two distinct nav entries

- GIVEN the authenticated navigation menu
- WHEN it renders
- THEN `Perfil` and `Seguridad` appear as separate entries with separate routes

#### Scenario: Legacy settings path redirects

- GIVEN a link to `/settings` (for example from an in-app notification)
- WHEN the therapist follows it
- THEN they land on `/security`

### Requirement: OAuth Redirect Resolution

The backend OAuth callback MUST redirect the browser, for success and for any failure (missing `code` or `state`, invalid or reused `state`, failed code exchange), to `<FRONTEND_URL>/security` with the query `calendar=connected` or `calendar=error`, and `Seguridad` MUST surface the result there.

#### Scenario: Successful OAuth return lands on Seguridad

- GIVEN a therapist completes Google OAuth successfully
- WHEN redirected back
- THEN they land on `Seguridad` with a success indicator

#### Scenario: Failed OAuth return lands on Seguridad

- GIVEN a therapist's Google OAuth attempt fails
- WHEN redirected back
- THEN they land on `Seguridad` with an error indicator, not a broken page

### Requirement: Calendar Panel Does Not Offer Connect Without Known Status

The Google Calendar panel MUST NOT offer the connect action while the connection status is loading or could not be loaded; it MUST show a loading or error state instead.

#### Scenario: Status request fails

- GIVEN `GET /calendar-integration/status` fails
- WHEN `Seguridad` renders the panel
- THEN an error message is shown and neither connect nor disconnect is offered
