-- issue #192: sesiones revocables. Tabla nueva y aditiva. Cada JWT de sesión
-- lleva un `jti` que referencia una fila; logout / logout-all fijan revokedAt.

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_jti_key" ON "Session"("jti");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Misma convención que la migración 20260804170000: toda tabla nueva del
-- schema public habilita RLS deny-all (sin policies). El rol de runtime tiene
-- rolbypassrls=true, así que no cambia nada para la app.
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
