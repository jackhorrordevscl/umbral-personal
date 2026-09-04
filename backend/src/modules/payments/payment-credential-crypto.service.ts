import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptAesGcm,
  encryptAesGcm,
  loadBase64Key,
} from '../../common/crypto/aes-gcm';

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
