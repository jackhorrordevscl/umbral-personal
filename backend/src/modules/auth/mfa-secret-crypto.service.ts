import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptAesGcm,
  encryptAesGcm,
  loadBase64Key,
} from '../../common/crypto/aes-gcm';

const ENV_VAR_NAME = 'MFA_SECRET_ENCRYPTION_KEY';

// Issue #302 (part 2): versioned prefix of the stored value. A TOTP secret is
// base32 (A-Z, 2-7), so it can never contain ':' -- a value without this
// prefix is unambiguously a legacy plaintext secret written before the
// encryption at rest, and is passed through untouched by decrypt().
export const MFA_SECRET_CIPHER_PREFIX = 'enc:v1:';

// Dedicated AES-256-GCM key (never shared with DOCUMENT_ENCRYPTION_KEY,
// GOOGLE_TOKEN_ENCRYPTION_KEY or PAYMENT_CREDENTIALS_ENCRYPTION_KEY), same
// payload scheme and startup validation as the other crypto services, via the
// primitives in common/crypto/aes-gcm.ts.
@Injectable()
export class MfaSecretCryptoService implements OnModuleInit {
  private key!: Buffer;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.key = loadBase64Key(
      this.config.get<string>(ENV_VAR_NAME),
      ENV_VAR_NAME,
    );
  }

  /** Encrypts a base32 TOTP secret into `enc:v1:<base64(iv|tag|ciphertext)>`. */
  encrypt(secret: string): string {
    const payload = encryptAesGcm(Buffer.from(secret, 'utf8'), this.key);
    return `${MFA_SECRET_CIPHER_PREFIX}${payload.toString('base64')}`;
  }

  /**
   * Returns the plaintext base32 secret. Legacy plaintext values (no prefix)
   * pass through. A prefixed value that is tampered with or was encrypted
   * under another key throws (GCM authentication failure).
   */
  decrypt(stored: string): string {
    if (!this.isEncrypted(stored)) return stored;
    const payload = Buffer.from(
      stored.slice(MFA_SECRET_CIPHER_PREFIX.length),
      'base64',
    );
    return decryptAesGcm(payload, this.key).toString('utf8');
  }

  isEncrypted(stored: string): boolean {
    return stored.startsWith(MFA_SECRET_CIPHER_PREFIX);
  }
}
