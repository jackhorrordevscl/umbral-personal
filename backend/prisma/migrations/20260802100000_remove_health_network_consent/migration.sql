-- Issue #6: HEALTH_NETWORK era la finalidad de consentimiento exclusiva del
-- acceso excepcional de SUPERVISOR a la red de salud, que ya no existe tras
-- el colapso a un único rol PROFESSIONAL (20260802090000_simplify_role_model).
-- Un profesional independiente no comparte fichas con otros profesionales, así
-- que esta finalidad quedó sin sentido de negocio.
--
-- PatientConsent es un ledger append-only (nunca se borra un evento
-- legítimo), pero los eventos HEALTH_NETWORK que puedan existir documentan un
-- consentimiento para una finalidad que el producto ya no ofrece ni puede
-- cumplir -- se eliminan en vez de recategorizarse, porque no hay ninguna
-- finalidad vigente equivalente a la que reasignarlos sin falsear el registro.
DELETE FROM "PatientConsent" WHERE "purpose" = 'HEALTH_NETWORK';

-- Mismo patrón que 20260802090000_simplify_role_model: se recrea el tipo
-- porque se elimina un valor, no se renombra uno (ALTER TYPE ... RENAME VALUE
-- no sirve para esto).
ALTER TABLE "PatientConsent" ALTER COLUMN "purpose" TYPE TEXT;
DROP TYPE "ConsentPurpose";
CREATE TYPE "ConsentPurpose" AS ENUM ('TREATMENT', 'TELEMEDICINE');
ALTER TABLE "PatientConsent" ALTER COLUMN "purpose" TYPE "ConsentPurpose" USING ("purpose"::"ConsentPurpose");
