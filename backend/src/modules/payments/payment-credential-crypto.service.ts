import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptAesGcm,
  encryptAesGcm,
  loadBase64Key,
} from '../../common/crypto/aes-gcm';

const ENV_VAR_NAME = 'PAYMENT_CREDENTIALS_ENCRYPTION_KEY';

// sdd/online-payment-integration PR 2 (T5.1): mismo delegador fino que
// DocumentEncryptionService/GoogleTokenCryptoService sobre las primitivas
// AES-256-GCM compartidas (common/crypto/aes-gcm.ts), con su propia clave
// independiente (PAYMENT_CREDENTIALS_ENCRYPTION_KEY, ya validada en
// env.validation.ts desde PR 1 -- 32 bytes en base64, requerida en
// producción). PaymentAccountService.onboard() la usa para cifrar
// PaymentAccount.credentialEncrypted.
@Injectable()
export class PaymentCredentialCryptoService implements OnModuleInit {
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
