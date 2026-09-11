-- Foto de perfil del propio profesional (avatar), no PHI clínico, sin
-- cifrar. Archivo guardado en una ruta fija (uploads/avatars/<userId>, sin
-- extensión) que cada nuevo upload pisa -- avatarMimeType guarda el tipo
-- real detectado por assertFileContentMatchesMimetype para poder servir el
-- Content-Type correcto al leerlo, y avatarUpdatedAt permite al frontend
-- armar una URL cache-busted (?v=avatarUpdatedAt) tras un re-upload.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarMimeType" TEXT,
ADD COLUMN     "avatarUpdatedAt" TIMESTAMP(3);
