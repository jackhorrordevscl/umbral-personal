# Tasks: Public Booking — Calendar Overlay and In-Page Payment Checkout

Two independent, flag-gated slices. PR 0 is a mandatory spike that gates whether the rest of Slice A (calendar overlay) proceeds as designed or falls back to the rejected forced-reconnect alternative. Slice B (in-page checkout) has no such gate and can ship independently — the two slices touch disjoint files except for the booking response type, so they are sequenced as separate chained PRs per `chain_strategy: stacked-to-main`, not because of a hard technical dependency.

Legend: **[P]** = can run in parallel with sibling tasks in the same PR (different files, no shared state). Tasks without [P] inside a PR are sequential (shared file or ordering dependency). PRs are always sequential (stacked).

---

## PR 0 — Spike: confirm `events.list` works under the existing `calendar.events` scope

Gates all of Slice A. Req: design.md Decision 1 guard ("Tasks MUST open with a spike").

- [ ] **0.1** Write a throwaway script (not shipped) that loads one real `GoogleCalendarConnection` refresh token from the DB (dev/staging) and calls `GET /calendars/primary/events?timeMin=...&timeMax=...&singleEvents=true&orderBy=startTime&fields=items(start,end,status,transparency,extendedProperties),nextPageToken` through the existing `GoogleCalendarClient` OAuth client plumbing.
- [ ] **0.2** Record the result: 200 with expected fields (proceed with PR 1–4 as designed), or 403 (STOP — escalate to the user; do not proceed with `events.list` design; fallback is the rejected forced-reconnect banner, which is a different design and out of scope for this task file until re-designed).
- [ ] **0.3** Document the spike result (request shape, response shape, any surprises re: recurrence expansion or `transparency`) inline as a code comment in the file created in 1.2, referencing this task number — no separate report file.

**Spec link**: `calendar-availability-overlay` Requirement "Periodic Free-Busy Cache Ingestion" (implicit precondition); design.md Decision 1.
**Exit condition**: 0.2 returns 200. If 403, STOP this task file's Slice A tasks and return to the user before writing PR 1.

---

## PR 1 — Overlay data layer: schema + Google read client

Depends on: PR 0 passing.

- [x] **1.1** Add `CalendarBusyBlock` model to `backend/prisma/schema.prisma`: `id`, `therapistId`, `startsAt`, `endsAt`, `@@index([therapistId, startsAt])` — same shape as `AvailabilityBlockout`. Add `busySyncedAt DateTime?` and `busySyncError String?` to `GoogleCalendarConnection`.
- [x] **1.2** Generate and commit the Prisma migration (additive only, no data migration).
- [x] **1.3 [P]** Add `BUSY_WINDOW_DAYS = 60` and `BUSY_REFRESH_CONCURRENCY` to `backend/src/modules/calendar-integration/calendar-integration.constants.ts`.
- [x] **1.4** Implement `listBusyIntervals()` on `google-calendar.client.ts`: paginated `events.list` with `fields=items(start,end,status,transparency,extendedProperties),nextPageToken`, `timeMin=now`, `timeMax=now+BUSY_WINDOW_DAYS`, `singleEvents=true`, `showDeleted=false`. Discard `status=cancelled`, `transparency=transparent`, all-day entries (`start.date` present, no `start.dateTime`), and events carrying `extendedProperties.private.umbralGroupId`. Reuse the existing `GoogleCalendarError` classification for auth/quota failures — do not invent a new error type.
- [x] **1.5** Unit tests for 1.4 over fixture payloads: recurrence-expanded events (already expanded by `singleEvents=true`, verify mapping only), cancelled/transparent/all-day dropped, `umbralGroupId`-tagged events excluded, pagination followed to completion.

**Spec link**: `calendar-availability-overlay` (persistence + ingestion source); `calendar-sync` (client reuse, no new OAuth scope).
**Est. lines**: ~180–220 (schema/migration ~40, client method ~70, tests ~90).

---

## PR 2 — Overlay refresh job + `AvailabilityService` consumption + flag

Depends on: PR 1.

- [x] **2.1** Implement `CalendarBusyService` (new file `backend/src/modules/calendar-integration/calendar-busy.service.ts`): `@Cron('*/30 * * * *')`, iterates therapists with an active `GoogleCalendarConnection`, skips connections without the read scope (per `calendar-sync` delta — see PR 3 for the scope-tracking field this reads), calls `listBusyIntervals()` per connection staggered at `BUSY_REFRESH_CONCURRENCY`, replaces that therapist's `CalendarBusyBlock` rows in one transaction, sets `busySyncedAt`, and calls `AvailabilityService.invalidate(therapistId)` after a successful write. On `invalid_grant`, route through the existing `handleInvalidGrant` path — job must never throw.
- [x] **2.2** Gate 2.1 entirely behind `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` (`X_ENABLED !== 'false'` convention per spec — confirm this matches the design.md "opt-in `=== 'true'`" note or reconcile: **design.md Migration/Rollout says both flags are opt-in `=== 'true'`, contradicting the spec's `!== 'false'` convention text for this flag** — follow design.md's explicit `=== 'true'` since it is the more specific, later-validated source; flag the discrepancy in the PR description, do not silently pick one without noting it).
- [x] **2.3** Add the sixth parallel query to `AvailabilityService.computeSlots()` (`backend/src/modules/availability/availability.service.ts:236`): read `CalendarBusyBlock` for the therapist/range, guarded by the flag; when flag is off or the therapist's overlay is stale/missing (no staleness-threshold config exists yet — add one, e.g. `OVERLAY_STALENESS_MS`, alongside the existing constants), concat nothing into `blockouts` and skip the query entirely rather than querying and discarding, to satisfy "no network call ... during slot computation" and keep flag-off byte-identical. Do **not** modify `computeAvailableSlots()` — its `blockouts` parameter is the only extension point (design.md Decision 3).
- [x] **2.4** Unit tests: overlay merged into `blockouts` when flag on and fresh; empty/stale overlay → output identical to pre-overlay `computeAvailableSlots()` call; `invalid_grant` during refresh routes to `handleInvalidGrant`, job resolves without throwing.
- [x] **2.5** E2E: flag off → byte-identical availability response to baseline (per Testing Strategy table), added to `backend/test`.

**Spec link**: `calendar-availability-overlay` all requirements; `therapist-availability` modified requirement.
**Est. lines**: ~220–260 (job ~90, service query ~40, tests ~130).

---

## PR 3 — OAuth scope broadening + re-consent (calendar-sync delta) — RECONCILED AS NO-OP

Depends on: PR 1. Originally planned as scope broadening + re-consent; reconciled during `sdd-apply` (see `apply-progress.md` PR 3 section for the full record) once PR 0's spike result and design.md Decision 1 were re-confirmed against what PR 1/PR 2 actually shipped.

- [x] **3.1** ~~Add scope tracking to `GoogleCalendarConnection`~~ — **not implemented.** No second Google scope is ever requested (Decision 1: `events.list` reads under the existing `calendar.events` scope, permanently, not conditionally). There is nothing to distinguish "has read scope" from "does not" — every `CONNECTED` connection already has full read access. A `scopes`/`hasReadScope` field would have no consumer and no real state to track; adding it would be speculative scope-tracking fiction, which this batch was explicitly instructed not to build.
- [x] **3.2** ~~Request the read scope in `calendar-oauth.service.ts`~~ — **not implemented.** There is no second scope to request. The OAuth consent request is unchanged from before this change: `calendar.events` only, as the base `calendar-sync` spec already states.
- [x] **3.3** ~~Implement the re-consent path~~ — **not implemented.** There is nothing to re-consent to. `CalendarBusyService.refresh()` (PR 2) already iterates every `CONNECTED` connection with no scope check (see inline comment at `calendar-busy.service.ts:30-36`, written during PR 2 to flag this exact deviation ahead of PR 3).
- [x] **3.4** ~~Unit/integration tests for pre-existing vs. re-consented connections~~ — **not implemented.** No tests were added for behavior that does not exist. PR 2.4's existing tests (all `CONNECTED` connections refresh uniformly) already cover the real behavior; inventing a re-consent test would test code that was never written.

**Spec link**: `calendar-sync` — delta reduced to a reconciliation note; no `MODIFIED Requirements` block, nothing merges into the base spec at archive time (see `specs/calendar-sync/spec.md`).
**Est. lines**: 0 (no production code; two doc files updated: this file and `specs/calendar-sync/spec.md`).

**Reconciliation resolution**: PR 0's spike (200 OK under `calendar.events`) confirmed Decision 1 was correct and PR 1/PR 2 were already built on that premise — `listBusyIntervals()` and `CalendarBusyService.refresh()` never reference a scope field, by design. Re-verifying against what actually shipped (not just the spike result in isolation) confirms there is no functional gate left for PR 3 to build. A "track pre-overlay vs. post-overlay connections" observability field was considered (in case Google changes its scope policy later) and rejected: it has no current consumer, tracks no current distinction, and speculative-future-policy-change is out of scope for this release — if Google ever does require a second scope, that is a new design decision with its own spike, not a field bolted on now against nothing.

---

## PR 4 — Payments: checkout URL exposure + Flow return endpoint verification

Independent of PR 1–3 (Slice B). No dependency on the overlay work; can be developed in parallel by a different contributor, but stacks after PR 1–3 per `chain_strategy`.

- [x] **4.1** Add `findCheckoutForBooking(groupId)` to `payments.service.ts`: returns `{ paymentUrl, amount } | { paymentUrl: null }`, reading only `Payment.paymentUrl`/amount for the consultation group — no mutation, no status assertion.
- [x] **4.2 [P]** Verify (do not rebuild) `POST|GET /api/v1/payments/return` → `resolveReturnRedirectUrl` (`payments.service.ts`) already satisfies the `payments` capability's "Flow Return Endpoint" requirement as written. Confirm `PAYMENT_RETURN_PATH` target and `PaymentReturnPage.tsx` match the spec scenarios exactly; **no code change expected** — if a gap is found, it is a small delta task, not new construction (per design.md Decision 2: "No backend or frontend change is required for the return path"). **Verified, zero-diff**: `PaymentsController.returnFromGatewayPost/Get` calls `resolveReturnRedirectUrl(token)` unconditionally and 302s to `{FRONTEND_URL}${PAYMENT_RETURN_PATH}` (`/pago-recibido`), optionally with `?token=`; the method only reads config, never touches `Payment` (matches "arrival does not change payment state"). Existing `resolveReturnRedirectUrl` describe block in `payments.service.spec.ts` already covers both scenarios; no gap found, no new tests added for this task.
- [x] **4.3** Extend `ensureCharge()` call site in `consultations.service.ts` (`createFromPublicBooking` path) so a synchronously-available checkout URL surfaces on the object `PublicSchedulingService.book()` returns, without making `ensureCharge()` itself awaited by the booking response (fire-and-forget stays fire-and-forget; only read the URL if already resolved at response-build time — do not add a wait).
- [x] **4.4** Unit tests: booking response carries checkout URL when already available; omits it without failing when account not `CONNECTED` or URL not yet ready; `findCheckoutForBooking` leaks no patient data (amount/URL only).

**Spec link**: `payments` ADDED "Checkout URL Exposure to the Booking Response", "Flow Return Endpoint".
**Est. lines**: ~140–180 (mostly test-heavy; 4.2 may be zero-diff verification).

---

## PR 5 — Public scheduling: booking response + checkout endpoint + confirmation UI

Depends on: PR 4.

- [x] **5.1** Add `checkout: CheckoutHint` (`{ status: 'PENDING' }` | `{ status: 'NOT_APPLICABLE' }`) to the `book()` response in `public-scheduling.service.ts`, gated by `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED`. `NOT_APPLICABLE` when `PaymentAccount.status !== CONNECTED` or no resolvable amount; `PENDING` otherwise (client polls).
- [x] **5.2** Add `GET /public/therapists/:therapistId/availability/book/:groupId/checkout` to `public-scheduling.controller.ts`, calling `findCheckoutForBooking` (PR 4.1), no auth guard, covered by the existing `PublicScheduleThrottlerGuard` and its `SkipThrottle` exhaustiveness test — add this new route to that exhaustiveness test explicitly.
- [ ] **5.3 [P]** Update `frontend/src/api/publicScheduling.ts`: add `checkout` field to `BookingConfirmation`, add `getBookingCheckout()` wrapper.
- [ ] **5.4** Update `PublicBookingPage.tsx` confirmation render: when `checkout.status === 'PENDING'`, poll `getBookingCheckout()` at the proposed 2s interval / ~15s ceiling (design.md still marks this as an open question — implement with these proposed defaults, extract them as named constants so a later PR can tune without touching poll logic) until a `paymentUrl` appears or the budget is exhausted, then render the checkout CTA + "you will leave this page" copy, or fall back to today's "you'll get an email" copy on exhaustion. When `checkout.status === 'NOT_APPLICABLE'` or absent, render only booking success, no CTA.
- [ ] **5.5** Handle `flow_return=1` query param on the confirmation route per spec scenario "Flow return arrival displays confirmation state, not payment status" — **note discrepancy**: this spec scenario references `/book/:therapistId?flow_return=1` as a return destination, but design.md Decision 2 explicitly states the real Flow return already redirects to `/pago-recibido?token=…` (`PaymentReturnPage`), not `/book/:therapistId`, and that no backend/frontend change is needed for the return path. Implement 5.5 as: if `flow_return=1` is ever present on `/book/:therapistId` (e.g., a stale link), render confirmation state without asserting payment status — but do **not** change `PaymentsController`'s redirect target to point here, since design.md's decision supersedes the spec's literal routing detail on this point. Document this resolution in the PR description.
- [x] **5.6** Integration tests: `NOT_APPLICABLE` when account not `CONNECTED` or amount unresolvable; checkout endpoint response shape leaks nothing but URL/amount; booking still succeeds end-to-end with Flow/Google unavailable (per success criteria).

**Spec link**: `public-scheduling` MODIFIED "Public Booking Write Endpoint", ADDED "Booking Confirmation Surfaces the Checkout Link In-Page".
**Est. lines**: ~260–320 (controller+service ~60, frontend ~140, tests ~120).

---

## PR 6 — Flags documentation, rollback verification, success-criteria pass

Depends on: PR 2, PR 3, PR 5 (final integration pass across both slices).

- [ ] **6.1 [P]** Document both flags (`CALENDAR_AVAILABILITY_OVERLAY_ENABLED`, `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED`) in whatever env-var reference doc/README section already lists `PUBLIC_SCHEDULING_ENABLED` and similar flags.
- [ ] **6.2** Manually verify each flag toggles independently (per proposal.md success criterion "Each flag toggles its feature without affecting the other") — smoke pass, not new automated tests unless a gap is found.
- [ ] **6.3** Confirm rollback plan holds: overlay flag off restores byte-identical `computeSlots()` (already covered by PR 2.5's E2E test — re-run it here as the closing gate); checkout flag off restores email-only flow (no new charge surfacing, existing behavior untouched).
- [ ] **6.4** Known-issue note (documentation only, no implementation): a first-time public patient auto-created via public booking has no `defaultSessionAmount`, so no charge is ever generated for them — explicitly out of scope per this task's constraints. Add this as a short note near the checkout code (e.g., a comment on `NOT_APPLICABLE`'s amount-unresolvable branch in PR 5.1) rather than a new doc file, since design.md already raises it as an Open Question.

**Spec link**: cross-cutting — proposal.md Success Criteria, Rollback Plan.
**Est. lines**: ~20–40 (docs + comments only).

---

## Review Workload Forecast

| PR | Area | Est. added/changed lines | Risk vs. 400-line budget |
|---|---|---|---|
| 0 | Spike (not shipped as product code) | ~40 (throwaway script, may not even enter the diff if run ad hoc against a scratch file outside the repo) | None — recommend running outside version control entirely, or in a `scripts/` file explicitly marked disposable |
| 1 | Overlay schema + Google client | ~180–220 | Under budget |
| 2 | Refresh job + `computeSlots()` consumption | ~220–260 | Under budget, near midpoint |
| 3 | OAuth scope + re-consent | 0 (reconciled as no-op — see PR 3 section) | None |
| 4 | Payments checkout exposure | ~140–180 | Under budget |
| 5 | Public scheduling endpoint + confirmation UI | ~260–320 | **Split executed**: **5a** (backend: 5.1/5.2/5.6 — `checkout` hint on `book()`, `GET .../checkout` endpoint, integration tests) landed at ~500 authored lines (Strict-TDD test-heavy, same over-forecast pattern as PR 1/PR 2 — `size:exception`, see apply-progress.md PR 5a section). **5b** (frontend: 5.3–5.5 — `getBookingCheckout()`, polling UI, `flow_return` handling) is a separate, NOT YET STARTED batch. |
| 6 | Docs + verification | ~20–40 | Negligible |

**Recommendation**: proceed with the 6-PR stacked chain as scoped (7 if PR 5 is split). Every PR individually stays under the 400-line review budget with PR 5 as the only one to watch — pre-emptively splitting it into 5a/5b is safe and keeps the stack uniformly small; decide at implementation time whether 5's actual diff justifies the split. PR 0 is a spike and should not land as product code if avoidable — prefer running it as a one-off script outside the tracked diff, or delete it in the same PR that consumes its findings (PR 1).

**Sequencing constraint**: PR 0 blocks PR 1–3 (Slice A) entirely; a 403 there means Slice A's remaining tasks are void pending a return to the user for a new design decision. PR 4–5 (Slice B) has no such gate and could ship first if Slice A's spike stalls — `chain_strategy: stacked-to-main` should stack Slice B ahead of Slice A in that case rather than blocking the whole chain on the spike.

---

## Key Learnings

- The Flow return endpoint and `PaymentReturnPage` are **already built and production-proven** (design.md Decision 2) — PR 4.2 is a verification task, not construction; resist the temptation to add tasks for infrastructure that already exists just because the spec's scenario language echoes an earlier (rejected) `flow_return=1` routing idea.
- Spec text for `public-scheduling`'s "Flow return arrival" scenario and design.md Decision 2 disagree on the return destination (`/book/:therapistId?flow_return=1` vs. the real `/pago-recibido`). Design.md is the later, code-validated source and wins; task 5.5 resolves this without touching the working return path — do not let the spec's literal routing text drive a regression to a redirect target design.md explicitly rejected.
- Decision 1's `events.list`-under-existing-scope finding means the `calendar-sync` spec's re-consent language may end up describing a scope-tracking mechanism with no functional gate behind it, pending the PR 0 spike. Tasks 3.1–3.3 stay written against the spec as-is; the PR 3 description is where the spike's actual implication gets reconciled, not this task file.
- The out-of-scope decision on `defaultSessionAmount` for auto-created public patients is preserved as a known-issue comment only (PR 6.4) — no fix task exists anywhere in this file, per explicit instruction.
- PR 5 is the single largest PR and the only one flagged as a candidate for a stacked split (5a/5b) if its real diff approaches 400 lines; every other PR has comfortable headroom.
- PR 3 was reconciled to a no-op during `sdd-apply`: Decision 1's `events.list`-under-existing-scope finding, already confirmed by PR 0's spike, means there was never a second scope for PR 1/PR 2 to gate on — and PR 2 was already built (and commented) without any scope check. Re-verifying the plan against the already-shipped PR 1/PR 2 code, not just against the spike result in isolation, is what confirmed PR 3 had zero remaining surface; see `apply-progress.md` PR 3 section for the full reasoning, including why a speculative scope-tracking field was rejected rather than built "just in case".
- PR 5's checkout GET endpoint (5.2) deliberately reuses the existing `'public-availability'` named throttler bucket instead of registering a third one. `ThrottlerModule` is `@Global()` in this codebase (PR 3's own key learning) — a third named bucket would force `@SkipThrottle` edits across every route in `auth.controller.ts` (~10 routes), `profile.controller.ts` (3 routes), and `email-change.controller.ts` (1 route), all of which already hardcode the exhaustive list of throttler names. Reusing an existing bucket kept the change scoped to `public-scheduling` only, at the cost of the checkout poll sharing its quota with `GET .../availability` (an accepted tradeoff for a read-only endpoint, documented inline in the controller and covered by an explicit "does NOT skip public-availability" test, not just an omission).
- PR 4's `findCheckoutForBooking(groupId)` is deliberately read-only and Prisma-`select`-scoped to `{ paymentUrl, amount }` — the leak boundary (tasks.md 4.4 "leaks no patient data") is structural (the DB driver itself never fetches other Payment columns), not an in-process filter that could regress if someone widens the query later. `createFromPublicBooking()` now awaits this lookup (not `ensureCharge()` itself) right after firing the still-fire-and-forget charge, matching payments spec.md's literal "synchronously available" scenario without violating design.md Decision 5 ("`ensureCharge()` stays fire-and-forget") — in production this will almost always resolve `checkoutUrl: null` since `ensureCharge()`'s first statement is an awaited Prisma read, but the code path is honest and exercised by tests rather than dead. `PublicSchedulingService.book()` needed zero changes: it already just returns whatever `createFromPublicBooking()` resolves to, so the new `checkoutUrl` field flows through untouched.
