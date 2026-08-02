-- Versionado inmutable de consultas (T2.3): corregir una consulta ya no
-- sobrescribe la fila original con UPDATE, crea una fila nueva que apunta
-- a la anterior vía correctsId. groupId identifica toda la cadena de
-- versiones de una misma consulta clínica.

-- 1. Agregar groupId como nullable primero (hay filas existentes)
ALTER TABLE "Consultation" ADD COLUMN "groupId" TEXT;

-- 2. Backfill: en filas ya existentes, la única versión que existe es la
--    original, así que groupId = su propio id
UPDATE "Consultation" SET "groupId" = "id" WHERE "groupId" IS NULL;

-- 3. Ahora sí, requerido
ALTER TABLE "Consultation" ALTER COLUMN "groupId" SET NOT NULL;

-- 4. Encadenamiento de versiones
ALTER TABLE "Consultation" ADD COLUMN "correctsId" TEXT;

CREATE UNIQUE INDEX "Consultation_correctsId_key" ON "Consultation"("correctsId");

CREATE INDEX "Consultation_groupId_idx" ON "Consultation"("groupId");

ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_correctsId_fkey"
  FOREIGN KEY ("correctsId") REFERENCES "Consultation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
