-- Issue #285: el RUT de un paciente dado de baja (soft-delete) debe poder
-- recrearse. La unicidad por terapeuta pasa a un indice unico PARCIAL que solo
-- considera fichas activas. Prisma no expresa indices parciales: vive solo en SQL.
--
-- Si falla por duplicados, hay dos fichas ACTIVAS con el mismo (therapistId, rut):
--   SELECT "therapistId", "rut", count(*) FROM "Patient"
--   WHERE "deletedAt" IS NULL GROUP BY 1, 2 HAVING count(*) > 1;

DROP INDEX IF EXISTS "Patient_therapistId_rut_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Patient_therapistId_rut_active_key"
  ON "Patient"("therapistId", "rut")
  WHERE "deletedAt" IS NULL;
