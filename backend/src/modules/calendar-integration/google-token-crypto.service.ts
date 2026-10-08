import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import {
  buildKeyring,
  decryptWithKeyring,
  Keyring,
} from '../../common/crypto/keyring';

const ENV_VAR_NAME = 'GOOGLE_TOKEN_ENCRYPTION_KEY';

// design.md "Dedicated GOOGLE_TOKEN_ENCRYPTION_KEY, not
// DOCUMENT_ENCRYPTION_KEY": clave AES-256-GCM propia (nunca compartida con
// DocumentEncryptionService) para el refresh token de Google Calendar --
// mismo esquema de payload y la misma validación de arranque (mirrors
// DocumentEncryptionService), vía las primitivas de common/crypto/aes-gcm.ts.
@Injectable()
export class GoogleTokenCryptoService implements OnModuleInit {
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
