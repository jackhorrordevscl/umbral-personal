import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import {
  buildKeyring,
  decryptWithKeyring,
  Keyring,
} from '../../common/crypto/keyring';

const ENV_VAR_NAME = 'DOCUMENT_ENCRYPTION_KEY';

// T8.1 (issue #58): cifrado de documentos en reposo con `crypto` nativo de
// Node (AES-256-GCM), sin depender de ningún proveedor cloud (KMS, S3, etc.)
// ni librería adicional -- mismo criterio que ya se usa para los backups
// (openssl AES-256 con una clave local, ver .github/workflows/backup.yml). El archivo en
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
  private keyring!: Keyring;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.keyring = buildKeyring(
      this.config.get<string>(ENV_VAR_NAME),
      this.config.get<string>(`${ENV_VAR_NAME}_KEYRING`),
      this.config.get<string>(`${ENV_VAR_NAME}_ACTIVE_KEY_ID`),
      ENV_VAR_NAME,
    );
  }

  // ADR 0005 (issue #382, T3a): migración de solo lectura. Se sigue cifrando
  // con la clave id 0 (la variable de entorno original) en formato legacy, para
  // que la versión anterior del servicio pueda leer lo que se escribe mientras
  // dura el despliegue. La escritura versionada se activa en T3b.
  encrypt(plaintext: Buffer): Buffer {
    return encryptAesGcm(plaintext, this.legacyKey());
  }

  // Lee tanto el formato legacy como el versionado a través del llavero.
  decrypt(payload: Buffer): Buffer {
    return decryptWithKeyring(payload, this.keyring);
  }

  private legacyKey(): Buffer {
    const key = this.keyring.keys.get(0);
    if (!key) throw new Error(`${ENV_VAR_NAME}: llavero sin clave id 0`);
    return key;
  }
}
