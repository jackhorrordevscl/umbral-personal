-- Colapsa el enum Role a un único valor (PROFESSIONAL): este producto no
-- tiene jerarquía institucional (ADMIN/SUPERVISOR/COORDINATOR/THERAPIST) --
-- cada cuenta es dueña exclusiva de sus propias fichas. Se recrea el tipo
-- en vez de ALTER TYPE ... RENAME VALUE porque colapsan 4 valores en 1, no
-- un simple alias como en 20260719012108_rename_director_to_supervisor.
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT;
DROP TYPE "Role";
CREATE TYPE "Role" AS ENUM ('PROFESSIONAL');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ('PROFESSIONAL'::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'PROFESSIONAL';

-- El acceso excepcional de SUPERVISOR sin consentimiento HEALTH_NETWORK
-- (T6.5, issue #52) no existe en este producto: no hay jerarquía que
-- sortear, así que no hay motivo que auditar.
ALTER TABLE "AuditLog" DROP COLUMN "overrideReason";
