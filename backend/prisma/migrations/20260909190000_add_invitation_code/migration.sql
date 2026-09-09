-- Issue #124: signup público sin invitación, sin rol ADMIN (decisión
-- explícita). InvitationCode es un código de un solo uso persistido en DB
-- (no JWT) porque AuthService.signup necesita poder marcarlo "usado" de
-- forma atómica junto con la creación del User, dentro de la misma
-- $transaction.

-- CreateTable
CREATE TABLE "InvitationCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "usedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvitationCode_code_key" ON "InvitationCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationCode_usedById_key" ON "InvitationCode"("usedById");

-- AddForeignKey
ALTER TABLE "InvitationCode" ADD CONSTRAINT "InvitationCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationCode" ADD CONSTRAINT "InvitationCode_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Misma convención que las migraciones 20260804170000, 20260825170000,
-- 20260825180000, 20260826120000 y 20260828190000 (issue
-- "rls_disabled_in_public"): toda tabla nueva del schema public debe
-- habilitar RLS deny-all (sin policies) para cerrar la exposición vía la API
-- PostgREST autogenerada de Supabase. El rol de runtime
-- (DATABASE_URL/DIRECT_URL) tiene rolbypassrls=true, así que esto no cambia
-- nada para la app.
ALTER TABLE "InvitationCode" ENABLE ROW LEVEL SECURITY;
