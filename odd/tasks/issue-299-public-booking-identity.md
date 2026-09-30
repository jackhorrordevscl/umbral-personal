# Issue #299 — Public booking leaks patient data and does not verify identity

## Objective
Public self-scheduling must not expose personal data, must verify the booker's identity against the existing patient record (option A: RUT must match), and abuse must be bounded.

## Scope
Backend only: `consultations.service.ts`, `patients.service.ts`, `public-scheduling/*`. Option B (email confirmation link) is explicitly out of scope.

## Config
- Branch: `fix/299-public-booking-identity`
- TDD: not configured; run ordinary functional checks (jest, lint, tsc) — runner: `npm test` in `backend/`
- Route: delegated direct (one writer, 4+ files)
- Delivery strategy: ask-on-risk; commits are Conventional Commits, `Closes #299` in the final commit

## Tasks
- [x] T1 — `createFromPublicBooking` returns only `id` and `sessionDate`  (50d8de5)
- [x] T2 — `resolveForPublicBooking`: existing email requires matching RUT; generic error otherwise
- [x] T3 — DTO validation: MaxLength, RUT format validator, `@IsEmail`
- [x] T4 — Throttler: extra limit per `ip:therapistId` and daily cap per therapist
- [x] T5 — Single transaction for patient + consultation; first-booking notification sent after commit

- [x] T6 — Daily cap counts only successful public bookings (DB count of self-scheduled consultations per therapist in the last 24h, 429 at the limit) instead of counting every POST in throttler storage. Accepted change: failed attempts create nothing after T5 and stay bounded by the per-ip:therapistId limit. (commit: `fix(public-scheduling): contar solo reservas exitosas en el tope diario`, hash in git log)

## Acceptance criteria
- Public booking response contains no patient data.
- Booking with an existing email and a different RUT is rejected without revealing which field failed.
- Changing the email on every request no longer bypasses the rate limit.
- A slot conflict leaves no orphan patient and no notification.
- Unit tests cover each point; `npm test`, lint and build pass.

## Progress
T1-T5 implemented in 4 commits: T3 09a3d7b, T4 10c4a92, T2 15eabdd, T1+T5 50d8de5 (Closes #299).
Checks observed: npm test 69 suites / 849 tests pass; e2e public-booking-checkout + public-scheduling 9 pass; npm run lint clean; tsc --noEmit clean.
Decisions: book() response keeps groupId (=== id) because the frontend polls checkout with it; checkoutUrl/patientId dropped. Extra throttles implemented inside PublicScheduleThrottlerGuard over the shared storage (no new named throttler). Not pushed, no PR.

T6: cap now counts `BookedSlot` rows (created only by createFromPublicBooking, one per confirmed public booking) with `createdAt` >= now - PUBLIC_BOOKING_DAILY_TTL_MS (default 24h) for the therapist; check lives at the start of PublicSchedulingService.book (after therapist lookup, before availability/transaction), 429 via ThrottlerException at >= PUBLIC_BOOKING_DAILY_LIMIT (default 100). Guard keeps only per-email and per-ip:therapistId limits. No migration.
Checks observed: npm test 69 suites / 855 tests pass; e2e public-booking-checkout + public-scheduling 9 pass; lint clean; tsc --noEmit clean.

## Next step
Push and open PR (user decision).
