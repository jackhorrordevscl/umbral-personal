import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildKeyring,
  decryptWithKeyring,
  encryptWithKeyring,
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

  // ADR 0005 (issue #382, T3b): cifra con la clave activa del llavero (id 0 por
  // defecto) en el formato 0x02, que autentica la cabecera y la etiqueta del
  // dataset (AAD). Una versión anterior a la que lee 0x02 no puede leer esto.
  encrypt(plaintext: Buffer): Buffer {
    return encryptWithKeyring(plaintext, this.keyring);
  }

  // Lee los formatos legacy, 0x01 y 0x02 a través del llavero.
  decrypt(payload: Buffer): Buffer {
    return decryptWithKeyring(payload, this.keyring);
  }
}
