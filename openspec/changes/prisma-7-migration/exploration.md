# Exploration: Backend — Prisma 6 → 7 migration (issue #75)

## Current State

Backend runs NestJS 11 on Prisma `^6.19.x` (`prisma` in devDependencies as of commit reachable via `git log` on main today, fixing the `deepmerge-ts`/`@prisma/config` CVE that was blocking `npm audit --omit=dev --audit-level=high` in CI — that narrow fix is done and out of scope here).

`backend/prisma/schema.prisma`:
- `generator client { provider = "prisma-client-js" }` — no `output` path (defaults into `node_modules/@prisma/client`), no `previewFeatures` flags at all.
- `datasource db { provider = "postgresql", url = env("DATABASE_URL"), directUrl = env("DIRECT_URL") }` — documented Supabase Supavisor (pgbouncer transaction-mode) setup: `DATABASE_URL` = pooled port 6543 `?pgbouncer=true` for runtime, `DIRECT_URL` = direct port 5432 for `prisma migrate`/`db execute`. `render.yaml` further clarifies `DIRECT_URL` actually points at Supabase's Session pooler (port 5432, IPv4) because Render has no IPv6 egress and Supabase's true "Direct connection" host is IPv6-only — this is the exact IPv6/pooler issue from issue #11 referenced in the task. No `prisma.config.ts` exists; all Prisma CLI config lives in `schema.prisma` + env vars only.
- Models are plain (no exotic features); nothing here interacts with generator/client changes beyond the generic ones below.

`PrismaService` (`backend/src/prisma/prisma.service.ts`) is a minimal `class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy` with only `$connect`/`$disconnect` lifecycle hooks — no constructor args, no `$use` middleware, no `$extends` client extensions, no custom logging config. `PrismaModule` (`backend/src/prisma/prisma.module.ts`) is a trivial `@Global()` provider/export wrapper. 42 callers of `PrismaService` across the codebase (per CodeGraph blast-radius).

`Prisma.*` namespace / `@prisma/client` usage (grepped across `backend/src`, backend-only — frontend has zero Prisma coupling):
- `Prisma.InputJsonValue` — `backend/src/common/utils/json-clone.util.ts`
- `Prisma.PrismaClientKnownRequestError` — `backend/src/common/filters/prisma-exception.filter.ts` (both as `@Catch()` decorator argument and as parameter/method type annotations, mapping P2002/P2025/P2003 to HTTP exceptions)
- `Prisma.TransactionClient` — `backend/src/modules/consultations/consultations.service.ts` (union type `PrismaService | Prisma.TransactionClient` for a helper that works inside or outside a `$transaction`)
- Plain `PrismaClient` import/instantiation — `backend/src/prisma/prisma.service.ts` (extends) and `backend/prisma/seed.ts` (`new PrismaClient()`, called via `npm run seed`)
- Generated enum/model type imports (not `Prisma.*` namespace, but still `@prisma/client` re-exports that a custom `output` path would relocate): `FileCategory` (shared-files service + 2 DTOs), `DocumentType` (documents service + DTO), `AuditAction` (audit.interceptor.ts, audit.service.ts), `ConsentPurpose`/`ConsentAction` (patients.service.ts, record-consent.dto.ts), and in test specs only: `User`, `Role`, `Patient`, `Consultation`, `SharedFile`.
- Total: ~14 production files + 5 spec files import from `@prisma/client` directly — this is the full blast radius for any import-path change.
- `$transaction` usage (array form and interactive callback form) appears in `auth.service.ts` (x2, array form) and `patients.service.ts`/`consultations.service.ts` (callback form) — API itself is unaffected by v7, only import paths of the types involved.
- No `$use` middleware and no `$extends` client extensions exist anywhere — this specific v5-era migration concern is moot for this codebase.

CI/CD and deploy touch points invoking Prisma CLI:
- `.github/workflows/ci.yml`: `npx prisma migrate deploy`, `npx prisma generate`, `npm run seed` (→ `ts-node prisma/seed.ts`), all against a plain (non-pooled) `postgres:16` service container — CI's `DATABASE_URL`/`DIRECT_URL` are identical, unlike production.
- `render.yaml`: build (`npx prisma generate`) and start (`npx prisma migrate deploy && npm run start:prod`) commands invoke the CLI directly; extensive comments document the Supabase IPv6/pooler workaround from issue #11.
- `backend/package.json` script `seed`: `ts-node prisma/seed.ts`.

Test suite counts (actual, verified by grep, not the issue's numbers): **157 unit tests** (`it(`/`test(` in `backend/src/**/*.spec.ts`, 16 files) and **119 e2e tests** (`backend/test/**/*.e2e-spec.ts`, 14 files) — **276 total**, not the issue's stale "90 unit + 107 e2e" (197). The issue's numbers predate recent feature work (email-change, audit hardening, etc.) and should be treated as outdated in any proposal/tasks phase.

## Researched Prisma 7 breaking changes (official upgrade guide + community migration writeups, all Jan 2026-era sources)

1. **Rust engine removed; mandatory driver adapters.** `PrismaClient` can no longer connect via a bare `url` string in the generated client — every database needs an explicit adapter (e.g. `@prisma/adapter-pg` for Postgres) passed into the constructor: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. This directly changes `PrismaService`'s current zero-arg `extends PrismaClient` shape and adds a new runtime dependency (`@prisma/adapter-pg`).
2. **`prisma.config.ts` replaces `package.json#prisma`/inline schema config** for CLI-level settings; datasource `url`/`directUrl`/`shadowDatabaseUrl` move out of `schema.prisma` into this new root-level config file (code, not declarative schema). Env vars are not auto-loaded by the CLI anymore — needs explicit `import "dotenv/config"` (already true for `seed.ts`; CI/Render set env vars directly so less exposed, but local dev workflow needs verifying).
3. **Generator `output` path becomes mandatory** — client no longer generates into `node_modules/@prisma/client` by default. This forces every one of the ~19 files above importing `from '@prisma/client'` to be repointed to the new generated path (or a path alias), the single largest mechanical blast radius of the whole migration.
4. **`$use()` middleware removed** in favor of `$extends()` client extensions — not applicable here (project uses neither).
5. **Connection pool defaults now come from the underlying driver (`pg`), not Prisma's own pool** — `pg`'s default has no built-in statement/connection timeout, unlike Prisma 6's ~5s default. This is the one behavior-level (non-mechanical) risk, and it lands directly on the part of this stack that has already caused a production incident: Supabase's Supavisor transaction-mode pooler (issue #11, IPv6-only direct host, PgBouncer transaction mode with no prepared-statement/session-state support). Pool tuning moves to the adapter constructor and needs explicit configuration, not a default carry-over.
6. Misc smaller items not relevant to this codebase: `Prisma.validator` legacy status, removed `--skip-generate`/`--skip-seed` CLI flags, automatic post-migrate seeding removed, ESM-only package (backend already uses CommonJS/ts-node — worth flagging for `ts-node prisma/seed.ts` and Jest's `ts-jest` transform compatibility).

## Affected Areas
- `backend/prisma/schema.prisma` — generator block needs `output`; datasource `url`/`directUrl` move to new `prisma.config.ts`.
- `backend/prisma/seed.ts` — `PrismaClient` instantiation needs adapter injection; import path changes.
- `backend/src/prisma/prisma.service.ts` — constructor must build and pass a `PrismaPg` adapter; new dependency `@prisma/adapter-pg`.
- ~14 production files + 5 spec files importing `@prisma/client` (enums, `Prisma.InputJsonValue`, `Prisma.PrismaClientKnownRequestError`, `Prisma.TransactionClient`) — import path bulk-update.
- `backend/package.json` — `prisma`/`@prisma/client` version bump, new `@prisma/adapter-pg` dependency, possibly `postinstall`/`generate` script wiring, `type: module` consideration.
- `.github/workflows/ci.yml` — `npx prisma migrate deploy`/`generate` steps still valid but must pick up `prisma.config.ts`; may need explicit env loading changes.
- `render.yaml` — build/start commands unchanged in shape but same config-migration exposure; the documented Supabase pooler/IPv6 workaround (issue #11) is exactly the area at highest behavioral risk from the new pg-driver-native pooling defaults.
- 157 unit + 119 e2e tests (276 total, not the issue's stale 197) — full suite must pass post-upgrade; e2e tests hit a real Postgres container so they're the most likely to surface pooler/timeout regressions.

## Approaches

1. **Full migration in one PR** — bump `prisma`/`@prisma/client` to 7, add adapter, move config to `prisma.config.ts`, bulk-fix ~19 import paths, re-run full suite.
   - Pros: one clean cutover, no intermediate dual-config state.
   - Cons: large diff (touches ~19+ files even though most changes are one-line import swaps), higher review burden, harder to isolate a pooler-related e2e failure from an import-path typo.
   - Effort: Medium (mechanical bulk edit + one real config/behavior change).

2. **Staged migration** — PR 1: add `prisma.config.ts` + adapter while still on Prisma 6 if/where compatible (config file support may have landed in late 6.x per Prisma's deprecation-warning pattern), validate CI/Render pick it up; PR 2: bump the major version and fix remaining import paths; PR 3 (if needed): tune adapter pool/timeout settings against Supabase's pooler.
   - Pros: isolates the one genuinely risky change (pool/timeout behavior against Supavisor) from the mechanical bulk-rename; each PR stays well under typical review budgets; easier bisection if e2e tests regress.
   - Cons: more PRs/coordination overhead; Prisma 6 may not support `prisma.config.ts` cleanly, forcing PR 1 to still be version-bump-adjacent.
   - Effort: Medium overall, but each slice is Low.

3. **Defer / re-scope as "not urgent"** — issue itself says this is preventive maintenance, not urgent; the actual CI-blocking CVE symptom is already fixed by the devDependencies move.
   - Pros: zero immediate risk; team focuses on feature work.
   - Cons: technical debt accumulates; future audits may flag Prisma 6 EOL/security advisories; migration only gets larger as more `Prisma.*` usages and models are added.
   - Effort: none now, unknown/growing later.

## Recommendation

Approach 2 (staged migration) if/when the team decides to do this now: separate the mechanical import/config rename from the one real behavioral risk (driver-native connection pooling against Supabase's Supavisor transaction pooler, an area with prior production friction per issue #11). If the team wants a single PR, Approach 1 is acceptable given the change is mostly mechanical, but the pool/timeout configuration for the `pg` adapter must be explicitly reviewed and tested against the pooled `DATABASE_URL`, not left at driver defaults, before merging. Either way, this is NOT a pure "bump + fix type errors" migration — the mandatory driver-adapter requirement is a structural change to `PrismaService`, not just types, and it changes connection-pool behavior in exactly the subsystem this project has already had a documented incident with (issue #11).

## Risks

- **Behavioral, not just mechanical**: driver adapters change connection pooling semantics; `pg`'s lack of a default statement/connection timeout vs Prisma 6's ~5s default could surface as e2e-only flakiness or production hangs against Supavisor's transaction-mode pooler, which doesn't support prepared statements/session state.
- **Config migration correctness**: `prisma.config.ts` env loading is not automatic; CI relies on GitHub Actions env vars (fine) but local dev and Render's build/start commands need explicit verification that `DATABASE_URL`/`DIRECT_URL` still resolve correctly through the new config file.
- **Import-path blast radius undercounted risk**: ~19 files import from `@prisma/client`; missing one in a manual pass fails the build loudly (TypeScript), low risk of silent breakage, but real effort/review-size risk (400-line budget likely exceeded if bundled with other work).
- **Test suite count in the issue is stale** (90+107=197 vs actual 157+119=276) — any `sdd-tasks` validation effort estimate or PR-size math based on the issue's numbers will be wrong; use 276 as the ground truth.
- **ESM-only Prisma 7 package** interacting with the project's current CommonJS/ts-node/ts-jest toolchain (`ts-node prisma/seed.ts`, Jest via `ts-jest`) is an open question not resolved by this exploration — needs a spike/prototype before committing to a design.
- Supabase-specific: Session pooler on `DIRECT_URL` (IPv4, port 5432, per issue #11 workaround) vs true Direct connection — any adapter-level pool/timeout tuning must be validated against this pooler too, not just the transaction pooler on `DATABASE_URL`.

## Ready for Proposal

Yes — scope, affected files, and risks are well-defined enough for `sdd-propose` to draft a concrete plan. Recommend the proposal explicitly decide between the single-PR and staged approaches and correct the test-count figures the original issue cites.
