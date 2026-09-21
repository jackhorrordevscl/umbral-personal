-- Issue #135: computeSlots (availability.service.ts) y findByRange
-- (consultations.service.ts) filtran siempre therapistId + sessionDate en
-- rango. El índice simple "Consultation_therapistId_idx" no cubre ese
-- predicado eficientemente y, con versionado inmutable (cada corrección crea
-- una fila nueva), la tabla crece sin límite por terapeuta -- el gap se
-- agrava con el tiempo. El compuesto reemplaza al simple: por leftmost
-- prefix sigue cubriendo cualquier query que filtre solo por therapistId.
DROP INDEX "Consultation_therapistId_idx";

CREATE INDEX "Consultation_therapistId_sessionDate_idx" ON "Consultation"("therapistId", "sessionDate");
