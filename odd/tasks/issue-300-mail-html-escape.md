# Issue #300 — Emails interpolate names without HTML escaping

## Objective
No user-controlled data is rendered as HTML in outgoing emails, and name fields are bounded and normalized at the input DTOs.

## Scope
Backend only: `mail.service.ts` templates, a shared escape helper, and DTOs for signup/profile/patient names. The public-booking patient DTO already got MaxLength in #299; verify and only complete what is missing. Existing behavior of emails for legitimate names must not change.

## Config
- Branch: `fix/300-mail-html-escape`
- TDD: not configured; ordinary checks (jest, lint, tsc) — runner: `npm test` in `backend/`
- Route: delegated direct (one writer)
- Delivery: ask-on-risk; Conventional Commits in Spanish, `Closes #300` in the last commit
- Follow-up filed separately: #307 (infra pending from #301)

## Tasks
- [x] T1 — Shared HTML-escape helper (common/utils) with unit tests
- [x] T2 — Escape every user-controlled value interpolated in `mail.service.ts` templates (names, patient/therapist names, emails, any free text); tests with names containing `<`, `>`, `&`, quotes
- [x] T3 — DTOs for signup, profile and patient names: MaxLength + trim/normalize, no control characters; tests
- [x] T4 — Check other places that build HTML from user data (rg for template literals with `<`), and PDF/report generators only if they render HTML; report findings, fix only mail-related ones

## Acceptance criteria
- A patient name like `<img src=x onerror=alert(1)>` appears as literal text in every email template.
- Legitimate accented names (e.g. "José Núñez") and apostrophes render correctly.
- Name fields reject over-long values and control characters.
- `npm test`, lint, tsc pass.

## Progress
- T1+T2: commit 53e9a5e (escapeHtml + escape in every MailService HTML template, tests with hostile and legitimate names). Route: delegated writer.
- T3: PersonName decorator (trim, MaxLength 200, no control chars) on SignupDto.name, UpdateProfileDto.name (+MinLength 1), CreatePatientDto/UpdatePatientDto.fullName, PublicBookingPatientDto.fullName; spec in common/validators. Commit: this one.
- T4: no other HTML builders from user data found (PDF via pdfkit, not HTML; sanitized clinical notes already whitelisted). Out-of-scope note: reminders.service in-app notification body is plain text.

## Verification
- Full unit suite with jest --runInBand: 74 suites / 977 tests passed. Plain npm test (parallel) shows one random integration spec failing per run (shared DB), which passes in isolation.
- lint clean, tsc --noEmit clean.
- e2e (auth x2, signup, profile, patient-consent, public-scheduling, public-booking-checkout): 7 suites / 64 tests passed.

## Next step
Push and open PR (user decision).
