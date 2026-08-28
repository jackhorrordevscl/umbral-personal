# account-settings Specification

## Purpose

Split account settings into `Perfil` (identity/credentials) and `Seguridad` (MFA + Google Calendar connection), each with its own nav entry and route, keeping the Google OAuth return flow working.

## Requirements

### Requirement: Profile Section Scope

`Perfil` MUST contain name, email, and password management, and MUST NOT include MFA or Google Calendar controls.

#### Scenario: Perfil shows identity fields only

- GIVEN the therapist opens `Perfil`
- WHEN the page renders
- THEN it shows name, email, and password controls, and no MFA or Google Calendar control

### Requirement: Security Section Scope

`Seguridad` MUST contain MFA management and the full Google Calendar panel (connect, disconnect, status). That panel MUST NOT be duplicated elsewhere, including the calendar view.

#### Scenario: Seguridad shows MFA and Google Calendar panel

- GIVEN the therapist opens `Seguridad`
- WHEN the page renders
- THEN it shows MFA controls and the full Google Calendar connect/disconnect panel

#### Scenario: No duplicated Google Calendar controls

- GIVEN the calendar view shows a status badge
- WHEN the therapist looks for connect/disconnect controls
- THEN those exist only in `Seguridad`, never in the calendar view

### Requirement: Separate Navigation and Routes

`Perfil` and `Seguridad` MUST be two distinct navigation entries, each with its own route. They MUST NOT merge back into one settings page or route.

#### Scenario: Two distinct nav entries

- GIVEN the authenticated navigation menu
- WHEN it renders
- THEN `Perfil` and `Seguridad` appear as separate entries with separate routes

### Requirement: OAuth Redirect Resolution

After the split, the system MUST resolve the Google OAuth return redirect (success or error) to the page hosting the Google Calendar panel (`Seguridad`), surfacing the result there.

#### Scenario: Successful OAuth return lands on Seguridad

- GIVEN a therapist completes Google OAuth successfully
- WHEN redirected back
- THEN they land on `Seguridad` with a success indicator

#### Scenario: Failed OAuth return lands on Seguridad

- GIVEN a therapist's Google OAuth attempt fails
- WHEN redirected back
- THEN they land on `Seguridad` with an error indicator, not a broken page
