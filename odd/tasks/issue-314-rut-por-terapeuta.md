# Issue #314: Patient RUT uniqueness per therapist

## Objective
Replace global `Patient.rut @unique` with `@@unique([therapistId, rut])` so a therapist can only conflict with their own patients (closes RUT probing across therapists). Source: GitHub issue #314 (follow-up of #303 T4). Decision taken with the user: per-therapist uniqueness, separate PR.

## Scope
- In: `backend/prisma/schema.prisma` + one migration, `backend/src/modules/patients/patients.service.ts` (create check, public booking flow ~L442-498), any other `Patient` lookup by RUT without `therapistId`, unit tests (`patients.service.spec.ts`), one e2e proving two therapists can register the same RUT.
- Out: frontend, unrelated modules. Migration is NOT run against any DB.

## Settings
- TDD: not resolved as enabled; run functional checks.
- Runner: `npm test`, `npm run lint`, `npm run build` in `backend/`.
- Delivery strategy: ask-on-risk. Branch: `worktree-issue-314-rut-por-terapeuta`.

## Tasks
- [x] T1 schema + migration: drop global unique on rut, add compound unique (therapistId, rut). Route: delegated writer.
- [x] T2 patients.service: scope create check and public booking flow by therapistId; audit other RUT lookups. Route: delegated writer.
- [x] T3 tests: update unit specs, add e2e for same RUT across two therapists. Route: delegated writer.

## Acceptance
- Two therapists can create a patient with the same RUT; the same therapist cannot (409 only for own patients).
- Public booking still finds/creates the patient within the correct therapist.
- `npm test`, lint and build pass.

## Evidence / progress
- T1+T2 (+ unit spec updates): f5c044c. Migration 20261001120000_patient_rut_unique_per_therapist (drop Patient_rut_key, create Patient_therapistId_rut_key); not run against any DB. Audit: no other Patient lookups by rut (others are by id).
- T3 e2e: 2f8292e (backend/test/patient-rut-per-therapist.e2e-spec.ts) -- NOT executed: worktree has no .env (DATABASE_URL, JWT secret missing).
- Checks: npm lint OK, npm run build OK, npm test 1012 passed; 3 DB integration suites (calendar-sync, consultations, reminders) fail only for missing DATABASE_URL (environmental). e2e pending in an env with DB.
- Known gap: PATCH rut collision within a therapist yields P2002 (unchanged behaviour, not handled).

- Verified with local DB (127.0.0.1, umbral_db) after `prisma migrate deploy` applied 20261001120000_patient_rut_unique_per_therapist (before applying, the new e2e got 500 from the old Patient_rut_key index, as expected): patient-rut-per-therapist e2e 3/3 passed; public-scheduling, public-booking-checkout and patient-consent e2e: 26/26 passed.
- The 14 `npm test` failures (calendar-sync, consultations, reminders integration) persist: those suites read DATABASE_URL from the process env, and jest unit config does not load .env. Environmental, unrelated to this change.

## Next step
Push branch and open PR (user decision).
