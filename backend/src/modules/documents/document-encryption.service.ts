import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptAesGcm,
  encryptAesGcm,
  loadBase64Key,
} from '../../common/crypto/aes-gcm';

const ENV_VAR_NAME = 'DOCUMENT_ENCRYPTION_KEY';

// T8.1 (issue #58): cifrado de documentos en reposo con `crypto` nativo de
// Node (AES-256-GCM), sin depender de ningún proveedor cloud (KMS, S3, etc.)
// ni librería adicional -- mismo criterio que ya se usa para los backups
// (openssl AES-256 con una clave local, ver backups/backup.sh). El archivo en
// disco queda como [IV(12)][authTag(16)][ciphertext], así no hace falta una
// columna nueva en PatientDocument para guardar el IV por separado.
//
// sdd/google-calendar-integration PR 1: las primitivas AES-256-GCM se
// extrajeron a common/crypto/aes-gcm.ts para que GoogleTokenCryptoService las
// reutilice con su propia clave (GOOGLE_TOKEN_ENCRYPTION_KEY) sin duplicar la
// implementación de cifrado — este servicio queda como un delegador fino,
// comportamiento idéntico al de antes (ver document-encryption.service.spec.ts,
// que no cambió y sigue siendo la red de regresión).
@Injectable()
export class DocumentEncryptionService implements OnModuleInit {
  private key!: Buffer;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.key = loadBase64Key(
      this.config.get<string>(ENV_VAR_NAME),
      ENV_VAR_NAME,
    );
  }

  encrypt(plaintext: Buffer): Buffer {
    return encryptAesGcm(plaintext, this.key);
  }

  decrypt(payload: Buffer): Buffer {
    return decryptAesGcm(payload, this.key);
  }
}
