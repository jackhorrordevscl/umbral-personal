-- issue #487: los códigos de invitación se guardan hasheados (SHA-256 hex del
-- código, igual que hashInvitationCode en la app). El código en claro se
-- entrega una sola vez al crearlo y no se lista en ninguna pantalla, así que
-- no hace falta conservarlo.
--
-- Los códigos existentes (usados, vencidos o vigentes) se convierten en el
-- lugar: un código vigente sigue sirviendo porque la app hashea lo que recibe
-- antes de buscarlo. Irreversible: el valor en claro no se puede recuperar.
-- sha256() es nativa de PostgreSQL 11 o posterior.
ALTER TABLE "InvitationCode" RENAME COLUMN "code" TO "codeHash";
ALTER INDEX "InvitationCode_code_key" RENAME TO "InvitationCode_codeHash_key";
UPDATE "InvitationCode"
SET "codeHash" = encode(sha256(convert_to("codeHash", 'UTF8')), 'hex');
