# Issue #301 — Evadable rate limits and wrong client IP behind the proxy

## Objective
One shared, safe way to compute the real client IP, used by every rate limiter and by audit/session/MFA records. Unauthenticated requests must not grow AuditLog without bound.

## Scope
Backend only. Topology assumed (documented in `auth.module.ts` and `render.yaml`): Render behind Cloudflare, `TRUSTED_PROXY_HOPS=3`. No infra changes.

## Config
- Branch: `fix/301-client-ip-proxy`
- TDD: not configured; ordinary checks (jest, lint, tsc) — runner: `npm test` in `backend/`
- Route: delegated direct (one writer, 4+ files)
- Delivery: ask-on-risk; Conventional Commits in Spanish, `Closes #301` in the last commit

## Tasks
- [x] T1 — `getLoginTracker`: when `hops.length < trustedProxyHops` fall back to `req.ip` instead of `hops[0]` (client-controlled)
- [x] T2 — Centralize client-IP computation in one shared helper (common/), reused by auth, payments and profile throttlers
- [x] T3 — `PublicScheduleThrottlerGuard` (and the T4 ip:therapistId bucket from #299) use the shared helper instead of raw `req.ip`
- [x] T4 — AuditLog.ipAddress, Session.ipAddress and MFA history use the real client IP through the same helper
- [x] T5 — `JwtAuthGuard` UNAUTHORIZED_ATTEMPT: strip query string from the stored URL and bound the writes (throttle/sampling per IP)

## Acceptance criteria
- A client cannot get a fresh rate-limit bucket by sending a crafted shorter `X-Forwarded-For`.
- Public-scheduling limits are per real client, not per proxy.
- Audit/session/MFA records show the real client IP.
- Unauthenticated request floods do not create unbounded AuditLog rows; no query string is stored.
- Unit tests for each point; `npm test`, lint, tsc pass.

## Progress
- T1-T4 done in d6e1a4e: helper `getClientIp` (`backend/src/common/utils/client-ip.util.ts`), `ClientIpMiddleware` (sets `req.clientIp` once from `TRUSTED_PROXY_HOPS`, registered in `AppModule.configure`), `getRequestClientIp(req)` used by AuditInterceptor, JwtAuthGuard and AuthController (sessions, MFA history, logout). `getLoginTracker` delegates to the helper, so payments/profile/auth throttlers share it. Public scheduling guard reads hops from config.
- T5 done in the closing commit (hash: see git log): path-only detail, per-IP in-memory window (`UNAUTHORIZED_AUDIT_LIMIT`=10 / `UNAUTHORIZED_AUDIT_WINDOW_MS`=60000, tracked-IP cap 10000).
- Route: delegated direct (single writer).
- Checks: `npm test` 72 suites / 879 passed; `npm run lint` clean; `tsc --noEmit` clean; e2e 20/21 suites pass (178/179 tests). The one failure, `calendar-busy-overlay.e2e-spec.ts`, also fails on unmodified main (verified with git stash), unrelated.
- Existing spec changed on purpose: `rate-limit-login.e2e-spec.ts` (short XFF with hops=3 now expects req.ip, not hops[0]).

## Next step
Push and open PR (user decision). Commit hashes: T1-T4 d6e1a4e; T5 the closing commit (hash: see git log).
