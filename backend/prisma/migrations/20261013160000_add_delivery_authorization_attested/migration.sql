-- Declaración del terapeuta de que revisó la autorización antes de entregar el
-- informe a un tercero. Aditiva: las entregas anteriores quedan en false (no
-- declararon nada) y no se reescribe ninguna fila.
ALTER TABLE "DischargeDelivery" ADD COLUMN "authorizationAttested" BOOLEAN NOT NULL DEFAULT false;
