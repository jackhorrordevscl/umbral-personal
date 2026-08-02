import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// T8.1 (issue #58): cifrado de documentos en reposo con `crypto` nativo de
// Node (AES-256-GCM), sin depender de ningún proveedor cloud (KMS, S3, etc.)
// ni librería adicional -- mismo criterio que ya se usa para los backups
// (openssl AES-256 con una clave local, ver backups/backup.sh). El archivo en
// disco queda como [IV(12)][authTag(16)][ciphertext], así no hace falta una
// columna nueva en PatientDocument para guardar el IV por separado.
@Injectable()
export class DocumentEncryptionService implements OnModuleInit {
  private key!: Buffer;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const raw = this.config.get<string>('DOCUMENT_ENCRYPTION_KEY');
    if (!raw) {
      throw new Error(
        'DOCUMENT_ENCRYPTION_KEY no está definida. Generala con: openssl rand -base64 32',
      );
    }

    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_LENGTH) {
      throw new Error(
        `DOCUMENT_ENCRYPTION_KEY inválida: debe decodificar a ${KEY_LENGTH} bytes en base64 (obtenido: ${key.length}). Generala con: openssl rand -base64 32`,
      );
    }

    this.key = key;
  }

  encrypt(plaintext: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, ciphertext]);
  }

  decrypt(payload: Buffer): Buffer {
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
