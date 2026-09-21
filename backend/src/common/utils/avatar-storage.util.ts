import * as path from 'path';
import * as fs from 'fs/promises';

// Issue #155: extraído de ProfileService para que el endpoint público de
// avatar (PublicTherapistProfileService) lea del mismo lugar sin duplicar la
// ruta ni el fs.readFile -- una sola fuente de verdad para dónde vive cada
// avatar en disco. Ruta fija por usuario (SIN extensión), ver comentario
// original en profile.service.ts sobre por qué no pasa por
// DocumentEncryptionService (no es PHI clínico).
export const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');

export function avatarPath(userId: string): string {
  return path.join(AVATAR_DIR, userId);
}

export async function readAvatarBuffer(userId: string): Promise<Buffer> {
  return fs.readFile(avatarPath(userId));
}
