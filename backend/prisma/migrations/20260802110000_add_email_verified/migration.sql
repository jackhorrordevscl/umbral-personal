-- Issue #5: signup propio con verificación de email. Default TRUE (no
-- FALSE): las cuentas ya existentes (seedeadas o creadas directo vía Prisma)
-- nunca pasaron por POST /auth/signup y no deben quedar bloqueadas al login
-- por esta migración retroactiva -- AuthService.signup es el único lugar que
-- crea una cuenta con emailVerified=false.
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT true;
