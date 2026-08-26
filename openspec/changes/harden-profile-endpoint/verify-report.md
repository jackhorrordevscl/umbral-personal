# Verification Report: harden-profile-endpoint

IMPORTANT: this report covers two independently-verified scopes. Read the section header before drawing conclusions.

---

## PR A (already archived, NOT re-verified in this pass)

PR A (step-up auth, deferred pending-email state machine, throttling, audit logging) was previously verified in Engram observation id 1178 (PASS WITH WARNINGS), post-verify cleanup applied in apply-progress Batch 1, and merged to main as commit c3a83b8. This verification pass did not re-run PR A's test suite or re-check its requirements; it only relies on PR A's merged state as a stable baseline for PR B. Any statement below about "known gaps" originating in PR A is carried forward for context only, not re-adjudicated here.

---

## PR B (this verification) -- session-invalidation domain

Change: harden-profile-endpoint (issue #76), PR B scope only
Branch: harden-profile-endpoint-pr-b (off up-to-date main, uncommitted working tree per instruction)
Mode: Full artifacts (proposal/spec/design/tasks all present) + Strict TDD active
Artifacts read: spec (Engram #1174, session-invalidation domain), design (Engram #1175), tasks (Engram #1176, PR B section), apply-progress (Engram #1177, Batch 2 + Batch 3)

### Task Completeness (tasks.md PR B section)

| Task | Status | Verified against source |
|---|---|---|
| B1.1 schema.prisma: passwordChangedAt DateTime? | Done | Confirmed via git diff cached -- nullable, additive, documented no-backfill rationale in comment |
| B1.2 migration 20260825120000_password_changed_at | Done | Confirmed file content: single ALTER TABLE ADD COLUMN, no backfill, no default |
| B2.1 RED jwt.strategy.spec.ts | Done | File exists, 7 tests, all pass |
| B2.2 GREEN jwt.strategy.ts iat check | Done | Matches design exactly: floor-seconds comparison, NULL skips |
| B3.1 profile.service.ts sets passwordChangedAt + clears pending | Done | Confirmed in password branch of update() |
| B3.2 auth.service.ts sets passwordChangedAt in resetPassword/changePassword + audits PASSWORD_CHANGED | Done | Confirmed in both methods; resetPassword logs both PASSWORD_RESET_COMPLETED and PASSWORD_CHANGED (additive, not duplicated) |
| B3.3 (Batch 3) auth.service.ts also clears pendingEmail/pendingEmailTokenIssuedAt in both flows | Done | Confirmed in both data objects |
| B4.1 session-invalidation.e2e-spec.ts (5 tests) | Done (deliberately excluded from working tree, stashed) | Retrieved full content via git show on the stash's untracked-files commit; 5 tests map 1:1 to spec scenarios |
| B4.2 regression run | Done | Reproduced independently: 157/157 |
| B4.3 (Batch 3) auth.service.spec.ts 2 new tests | Done | Confirmed via stash diff |

All 7 PR B checklist items (plus the two testing sub-items and Batch 3's B3.3) are complete and match the actual source, not just the checkbox.

### Test / Build / Lint / Coverage Evidence (independently executed, not trusted from apply-progress)

| Command | First run (stale local Prisma client) | After npx prisma generate (diagnostic-only, no source edited) |
|---|---|---|
| npm test (from backend/) | 157/157 passed, 16 suites -- matches apply-progress's claim exactly | 157/157 passed (unchanged) |
| npx nest build | FAIL, exit 1 -- 5 TS errors: passwordChangedAt not recognized on UserUpdateInput/UserSelect (auth.service.ts:326, auth.service.ts:475, jwt.strategy.ts:60, jwt.strategy.ts:79, jwt.strategy.ts:80) | PASS, exit 0 |
| npm run lint | FAIL, exit 1 -- 2 errors: no-unsafe-call/no-unsafe-member-access on jwt.strategy.ts:80, cascading from the same unresolved Prisma type | PASS, exit 0 |
| npm run test:cov | 157/157 passed; jwt.strategy.ts 100%/90.9%/100%/100% (stmt/branch/func/line); auth.service.ts 95.63%/87.28%/96.15%/95.54%; profile.service.ts 87.23%/84.21%/50%/90.24% | (not re-run, unaffected by client regen) |

Root cause, diagnosed (not fixed): node_modules/.prisma/client in this sandbox was generated on 2026-08-23 (before PR B's schema edit on 2026-08-25) and was never regenerated after passwordChangedAt was added to schema.prisma. Confirmed via grep on the generated index.d.ts: it already includes PR A's pendingEmail field but not PR B's passwordChangedAt. Running npx prisma generate (a codegen step, not a source edit) against the current schema.prisma immediately resolved all 5 build errors and both lint errors with no other change. This is consistent with @prisma/client's own postinstall hook (node scripts/postinstall.js), which regenerates the client automatically on npm install/npm ci -- so a genuinely fresh CI checkout (.github/workflows/ci.yml's backend job runs npm ci before Lint) would not reproduce this, because npm's install-time postinstall already ran prisma generate against the up-to-date schema. Downgraded to WARNING, not CRITICAL, since it is local generated-artifact staleness rather than a defect in the committed/staged source, but it is worth calling out because CI's explicit npx prisma generate step (line 59-60 of ci.yml) runs after its explicit Lint step (line 53-54) -- the pipeline currently only works by accident of npm's implicit postinstall ordering, and any change to install behavior (e.g. --ignore-scripts, a lockfile change that skips postinstall) would break both CI and local dev builds identically for this and any future schema field.

### Spec Compliance Matrix -- session-invalidation domain (4 requirements, 8 scenarios)

| Requirement / Scenario | Compliance | Evidence |
|---|---|---|
| passwordChangedAt Tracking -- PATCH /profile sets timestamp | COMPLIANT | profile.service.spec.ts unit test passing |
| passwordChangedAt Tracking -- resetPassword sets timestamp | COMPLIANT | auth.service.spec.ts unit test passing |
| passwordChangedAt Tracking -- mustChangePassword completion sets timestamp | COMPLIANT | auth.service.spec.ts unit test passing |
| No Forced Logout on Deploy -- pre-deploy NULL token stays valid | COMPLIANT | jwt.strategy.spec.ts NULL-skip test passing |
| Token Rejection -- token before PATCH /profile change rejected | COMPLIANT (mechanism-level) | jwt.strategy.spec.ts iat-1s-before-rejects unit test passing; HTTP-level route proof only in infra-blocked/stashed e2e (out of scope per explicit instruction) |
| Token Rejection -- token after change accepted | COMPLIANT | jwt.strategy.spec.ts iat-after-accepts + iat-floor-equal-accepts unit tests passing |
| Token Rejection -- resetPassword invalidates every device | COMPLIANT (mechanism-level only) -- see WARNING #2 | Composition of two separately-tested units (resetPassword sets the field; JwtStrategy checks the field generically) proves the mechanism, but no currently-runnable test exercises the specific two-independent-device-tokens scenario end-to-end -- that proof lives only in the infra-blocked/stashed e2e |
| Token Rejection -- password-change-purpose tokens never accepted as session tokens | COMPLIANT | jwt.strategy.spec.ts purpose-blocklist regression test passing (pre-existing check, retained and re-verified against the new code) |

8/8 scenarios have at least mechanism-level unit test coverage backed by a passing runtime test; 0 CRITICAL UNTESTED/FAILING scenarios.

### Design Coherence

| Design decision | Implemented as designed? |
|---|---|
| iat compared in whole seconds (floor), no grace constant | Yes -- exact Math.floor(user.passwordChangedAt.getTime() / 1000) comparison, matches design's interface block verbatim |
| PATCH /profile password change mints no replacement token | Yes -- unaffected by PR B, profile.service.ts still returns the profile object, no token |
| "Any password change also clears pending [email]" applied uniformly to all 3 entry points | Yes, as of Batch 3 -- profile.service.ts (B3.1) and both auth.service.ts methods (B3.3) now clear pendingEmail/pendingEmailTokenIssuedAt identically |
| Migration additive, nullable, no backfill | Yes -- single ALTER TABLE ADD COLUMN, comment explicitly documents "no forced logout" rationale |
| JwtStrategy purpose blocklist should include email-change | Not implemented -- pre-existing PR A gap, confirmed still absent from the blocklist (mfa-setup, password-change, email-verify, password-reset only). Explicitly out of scope for PR B per task instructions; not fixed here |

### Issues Found

CRITICAL: None.

WARNING #1 -- Local Prisma Client staleness masks build/lint failures until regenerated. npx nest build and npm run lint both failed against the working tree's node_modules/.prisma/client (last generated 2026-08-23, before PR B's 2026-08-25 schema change) with 5 TS errors + 2 lint errors, all pointing at passwordChangedAt being unrecognized. Running npx prisma generate (diagnostic only, no source touched) fixed all 7 errors immediately with zero other changes, confirming this is generated-artifact drift, not a source defect. npm test/npm run test:cov were unaffected (157/157 both before and after), which is why apply-progress's Batch 2/3 evidence never surfaced this -- Jest's ts-jest transform apparently does not fail the same way tsc's project-wide check and eslint's type-aware rules do. Recommend either (a) adding an explicit postinstall/generate npm script that CI/dev docs call out after any schema edit, or (b) reordering ci.yml's backend job so Lint/build steps run after the explicit npx prisma generate step (currently they rely on npm's implicit install-time postinstall hook, which is fragile against --ignore-scripts or lockfile changes).

WARNING #2 -- "resetPassword invalidates tokens from every device" has no currently-runnable end-to-end proof. The scenario is proven only by composing two independently unit-tested halves (the field gets set generically; the field gets checked generically) plus the infra-blocked/stashed session-invalidation.e2e-spec.ts. This is consistent with the explicit scope instruction not to require the e2e suite to run for this verification's PASS/FAIL verdict, and is the same category of gap PR A's own verify report (#1178) already accepted as SUGGESTION-level for its e2e suite -- flagged here as WARNING (not CRITICAL) to keep it visible for the follow-up e2e PR.

SUGGESTION #1 -- session-invalidation.e2e-spec.ts remains unexecuted. Same pre-existing infra gap as PR A (missing local Postgres/.env), confirmed via identical failure mode on unmodified forgot-reset-password.e2e-spec.ts (per apply-progress Batch 2). Content reviewed directly from the stash and is sound (5 tests, 1:1 with spec scenarios). Explicitly out of this PR's delivered scope per instructions -- will ship in the stacked follow-up PR.

SUGGESTION #2 -- JwtStrategy purpose blocklist missing 'email-change'. Pre-existing PR A gap, discovered during PR B work, confirmed still present in the current source. Explicitly out of scope for PR B; recommend a small, separate follow-up task against PR A's domain.

### Verdict

PASS WITH WARNINGS

All PR B tasks (B1.1-B4.3) are complete and match actual source. All 8 session-invalidation spec scenarios have passing mechanism-level test coverage; the composed "every device" behavior and the full HTTP-level path additionally depend on the stashed, infra-blocked e2e suite, consistent with the explicit scope carve-out given for this verification. npm test/npm run test:cov pass cleanly (157/157, independently reproduced). npx nest build/npm run lint failed initially due to a stale local generated Prisma Client (not a source defect -- confirmed resolved by prisma generate alone) but this is flagged as a process WARNING rather than a merge blocker, since CI's npm ci would regenerate the client automatically before its own lint/build steps run.

Ready for sdd-archive once the delivery-strategy decision on the flagged budget-risk (626+ changed lines vs. ~320 forecast, from tasks.md's Review Workload Forecast) is made by the orchestrator/user -- that decision is outside this verification's scope but is a precondition apply-progress itself flagged as still open.
