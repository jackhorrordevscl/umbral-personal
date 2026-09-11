# Verification Report: patient-self-scheduling

**Verdict: PASS WITH WARNINGS**

## Completeness

28/28 tasks across 5 phases (PR1-PR5) marked `[x]` in tasks.md, all confirmed against actual code, not just checkmarks.

## Test Evidence (re-run fresh this session; prior batch reports not trusted blindly)

- Frontend `npm test` (vitest): 21/21 files, 118/118 tests PASS.
- Backend `npm test` (jest): 51/51 suites, 564/564 tests PASS, including `consultations.service.integration.spec.ts`'s real-Postgres concurrent-insert test (`Promise.allSettled`, exactly one fulfilled + one `ConflictException`).
- Backend `npm run test:e2e`: 17/19 suites pass, 157/164 tests pass. 7 failures isolated to `auth-force-password-change.e2e-spec.ts` and `auth-mfa-enforcement.e2e-spec.ts` — **pre-existing, unrelated to this change**. Verified with `git stash push -u` to the pre-change baseline and re-running the same two spec files in isolation: identical 7 failed / 5 passed with zero patient-self-scheduling code present. Root cause: the local dev Postgres instance carries mutated seed-admin state (password/MFA) from prior manual e2e runs; CI is unaffected because each job spins up a fresh ephemeral Postgres container. `public-scheduling.e2e-spec.ts` itself (the actual spec under test for this change) PASSED in full: unauthenticated reachability, 60-day span rejection, 429 throttling, existing auth throttlers unaffected.
- Working tree fully restored after the stash diagnostic (`git status` verified byte-identical before/after).

## Spec Compliance Matrix

| # | Check | Result |
|---|---|---|
| 1 | `BookedSlot.@@unique([therapistId, slotStart])`, not a `Consultation`-level constraint | PASS — confirmed in `schema.prisma` and `migration.sql` (`BookedSlot_therapistId_slotStart_key`) |
| 2 | Single `PUBLIC_SCHEDULING_ENABLED` flag gates both read and booking endpoints | PASS — single `assertEnabled()` call in both `PublicSchedulingService.getAvailability()` and `.book()` |
| 3 | Holiday seed never hits Boostr.cl live in CI | PASS — `seed.ts` gates `seedHolidaysFromBoostr` behind `SEED_HOLIDAYS === 'true'`; `.github/workflows/ci.yml`'s `npm run seed` step never sets that var |
| 4 | 24h min lead / 60d max horizon enforced server-side | PASS — `AvailabilityService.computeSlots` (`MIN_LEAD_TIME_MS`/`MAX_HORIZON_MS`) + re-validated in `PublicSchedulingService` at query and booking time |
| 5 | Patient identity resolution: existing-link, new-patient reduced form, uniform 409 for ambiguous email / cross-therapist RUT collision | PASS — `resolveForPublicBooking` in `patients.service.ts`, both failure paths throw the identical `ConflictException` message |
| 6 | Every `@SkipThrottle` map in `auth.controller.ts` updated exhaustively | PASS — 11 total maps found (not 3), every one contains both `'public-availability'` and `'public-booking'`; no missed entry |
| 7 | No backend code touched in PR4/PR5 batches | PASS — all modified backend files trace to PR1-3 scope; PR4/5 touch only frontend files |
| 8 | `git status` scope matches the 5 apply batches' claims | PASS — all modified/untracked files map 1:1 to design.md's File Changes table and tasks.md's per-phase list |

## Design Coherence

- `AvailabilityModule` / `PublicSchedulingModule` import direction matches design (no cycle).
- Wall-clock storage (`dayOfWeek`/`startMinute`/`endMinute` as `Int`) implemented as specified (Decision 5).
- Cache: in-process `Map`, no new dependency (Decision 6).
- `createFromPublicBooking` reuses the private `emitCalendarSync`/`emitPaymentCharge` methods — confirmed by a dedicated regression test (`consultations.service.spec.ts`: "dispara emitCalendarSync/emitPaymentCharge igual que create()"), satisfying tasks.md 3.9 and the calendar-sync spec's "Publicly booked consultation pushes a new event" / "sync failure does not block booking" scenarios.
- `main.ts` CORS `methods` gained `PUT` — documented, justified (first PUT endpoint in the backend), traced to PR2/task 2.4, not a PR4/5 scope leak.
- `AvailabilityService` CRUD scope extension beyond `computeSlots`/`invalidate` is consistent with task 2.4's explicit requirement for an authenticated CRUD controller; not a scope violation.

## Issues

**CRITICAL**: None.

**WARNING**:
1. Holiday seed deviation from tasks.md 1.5's literal wording (opt-in `SEED_HOLIDAYS=true` vs. "invoke the holiday seed for local/dev bootstrap") — justified by the CI network-free constraint in design.md's Holiday Data Source section. Task wording is now slightly stale; a documentation-only fix, no code action needed.
2. Local backend e2e run shows 7 failing tests in `auth-force-password-change`/`auth-mfa-enforcement`, confirmed pre-existing (reproduced identically on a git-stashed pre-change baseline) and environment-local (stale seed-admin DB state in the developer's local Postgres), not a regression from this change. The maintainer's local dev DB would need a `prisma migrate reset` (requires explicit consent) or equivalent to get a fully clean baseline; CI is unaffected since it uses a fresh ephemeral Postgres container per run.

**SUGGESTION**: None.

## Conclusion

No CRITICAL findings. Both WARNINGs are non-blocking: one is a beneficial, already-justified deviation; the other is a pre-existing local-environment issue independently verified to predate this change and to not exist in CI. `patient-self-scheduling` is archive-ready.
