import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptAesGcm,
  encryptAesGcm,
  loadBase64Key,
} from '../../common/crypto/aes-gcm';

const ENV_VAR_NAME = 'GOOGLE_TOKEN_ENCRYPTION_KEY';

// design.md "Dedicated GOOGLE_TOKEN_ENCRYPTION_KEY, not
// DOCUMENT_ENCRYPTION_KEY": clave AES-256-GCM propia (nunca compartida con
// DocumentEncryptionService) para el refresh token de Google Calendar --
// mismo esquema de payload y la misma validación de arranque (mirrors
// DocumentEncryptionService), vía las primitivas de common/crypto/aes-gcm.ts.
@Injectable()
export class GoogleTokenCryptoService implements OnModuleInit {
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
