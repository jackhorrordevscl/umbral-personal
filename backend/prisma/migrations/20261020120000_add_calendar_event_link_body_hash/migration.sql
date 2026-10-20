-- issue #497: huella del cuerpo del evento enviado a Google. El reconciler la
-- compara con la del cuerpo actual para detectar cambios que no mueven la
-- fecha (duración, id de la consulta vigente, iniciales). Nullable: los links
-- existentes se comparan solo por fecha hasta su próximo push.
ALTER TABLE "CalendarEventLink" ADD COLUMN "lastBodyHash" TEXT;
