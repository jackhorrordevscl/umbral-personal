-- sdd/payments-multigateway-redesign M2 (design.md "Decision 3 — Prisma
-- migration", tasks.md 3.5): a DATA migration, not a schema change. It is a
-- SEPARATE deploy step that MUST run only AFTER the new backend (and
-- frontend) built on this change is already live -- an old Prisma client
-- throws when it reads a status value it doesn't know
-- (RECONNECT_REQUIRED), so flipping rows before the new code is deployed
-- would break every in-flight request that reads PaymentAccount.status
-- under the old binary. Do not include this file in the same deploy as M1.
--
-- Every account that was CONNECTED under the retired Comercios Asociados
-- split-payment model is flagged for mandatory reconnection: status moves
-- to RECONNECT_REQUIRED, the stale plaintext-adjacent v1 credentialEncrypted
-- blob (`{merchantId}`) is cleared (there is nothing left to decrypt safely
-- once the new code path assumes v2 `{apiKey,secretKey}` for any CONNECTED
-- row), and lastError carries an operator-facing note. Rows are marked,
-- never deleted (design.md "Rollback Plan" / proposal.md "Rollback Plan") --
-- connectedAt and the legacy plaintext merchantId column are left
-- untouched, so the prior state stays reconstructible for audit/rollback.
--
-- The WHERE clause is scoped to "credentialVersion" = 1 in addition to
-- status='CONNECTED' -- narrower than design.md's literal
-- "WHERE status='CONNECTED'" example. credentialVersion is the explicit
-- shape discriminator the schema comment describes as existing precisely
-- "never guessing the blob" (design.md "Decision 3"): if any therapist
-- already completed the NEW wizard (credentialVersion=2) between the M1
-- deploy and this M2 run, a bare status filter would incorrectly flip a
-- currently-valid connection back to RECONNECT_REQUIRED. Restricting to
-- credentialVersion=1 makes this migration target only genuinely legacy
-- rows, regardless of exactly how much time elapses between deploying the
-- new backend and running this step.
UPDATE "PaymentAccount"
SET
  "status" = 'RECONNECT_REQUIRED',
  "credentialEncrypted" = NULL,
  "lastError" = 'Tu conexión con Flow fue invalidada por una migración de seguridad. Vuelve a conectar tu cuenta desde Pagos para seguir recibiendo cobros automáticos.'
WHERE "status" = 'CONNECTED'
  AND "credentialVersion" = 1;
