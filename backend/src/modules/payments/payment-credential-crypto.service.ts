import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import {
  buildKeyring,
  decryptWithKeyring,
  Keyring,
} from '../../common/crypto/keyring';

const ENV_VAR_NAME = 'PAYMENT_CREDENTIALS_ENCRYPTION_KEY';

// sdd/online-payment-integration PR 2 (T5.1): same thin delegator as
// DocumentEncryptionService/GoogleTokenCryptoService over the shared
// AES-256-GCM primitives (common/crypto/aes-gcm.ts), with its own
// independent key (PAYMENT_CREDENTIALS_ENCRYPTION_KEY, already validated in
// env.validation.ts since PR 1 -- 32 base64 bytes, required in
// production). PaymentAccountService.onboard() uses it to encrypt
// PaymentAccount.credentialEncrypted.
@Injectable()
export class PaymentCredentialCryptoService implements OnModuleInit {
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
