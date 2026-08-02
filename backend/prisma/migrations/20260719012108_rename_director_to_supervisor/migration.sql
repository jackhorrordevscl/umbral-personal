-- T6.4 (issue #51): DIRECTOR se renombra a SUPERVISOR para reflejar mejor el
-- rol real (supervisión clínica condicionada al consentimiento "Red de
-- salud", no jefatura institucional). ALTER TYPE ... RENAME VALUE remapea
-- automáticamente cualquier fila existente con role='DIRECTOR' a
-- role='SUPERVISOR' -- no hay que tocar la tabla User a mano ni hay riesgo
-- de pérdida de datos, a diferencia de lo que Prisma Migrate genera por
-- defecto para un rename de valor de enum (que lo trata como DROP + ADD).
ALTER TYPE "Role" RENAME VALUE 'DIRECTOR' TO 'SUPERVISOR';
