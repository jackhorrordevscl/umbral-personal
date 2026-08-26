import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// sdd/google-calendar-integration PR 1: primitivas AES-256-GCM extraídas de
// DocumentEncryptionService (T8.1, issue #58) para que GoogleTokenCryptoService
// las reutilice sin duplicar la implementación de cifrado — ambos servicios
// comparten el mismo esquema de payload ([IV(12)][authTag(16)][ciphertext])
// y el mismo criterio de validación de clave, pero cada uno mantiene su
// propia clave (DOCUMENT_ENCRYPTION_KEY / GOOGLE_TOKEN_ENCRYPTION_KEY) y su
// propio ciclo de vida de rotación (ver design.md, "Dedicated
// GOOGLE_TOKEN_ENCRYPTION_KEY, not DOCUMENT_ENCRYPTION_KEY").
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
export const AES_GCM_KEY_LENGTH = 32;

export function encryptAesGcm(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptAesGcm(payload: Buffer, key: Buffer): Buffer {
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Mismo mensaje de error que DocumentEncryptionService.onModuleInit tenía
// antes de la extracción, parametrizado por el nombre de la env var — así
// cada llamador (DocumentEncryptionService, GoogleTokenCryptoService) sigue
// mostrando su propio nombre de variable en el error de arranque.
export function loadBase64Key(
  raw: string | undefined,
  envVarName: string,
): Buffer {
  if (!raw) {
    throw new Error(
      `${envVarName} no está definida. Generala con: openssl rand -base64 32`,
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== AES_GCM_KEY_LENGTH) {
    throw new Error(
      `${envVarName} inválida: debe decodificar a ${AES_GCM_KEY_LENGTH} bytes en base64 (obtenido: ${key.length}). Generala con: openssl rand -base64 32`,
    );
  }

  return key;
}
