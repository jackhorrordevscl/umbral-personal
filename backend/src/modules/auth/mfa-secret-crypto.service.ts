import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import {
  buildKeyring,
  decryptTextWithKeyring,
  Keyring,
} from '../../common/crypto/keyring';

const ENV_VAR_NAME = 'MFA_SECRET_ENCRYPTION_KEY';

// Issue #302 (part 2): versioned prefix of the stored value. A TOTP secret is
// base32 (A-Z, 2-7), so it can never contain ':' -- a value without this
// prefix is unambiguously a legacy plaintext secret written before the
// encryption at rest, and is passed through untouched by decrypt().
export const MFA_SECRET_CIPHER_PREFIX = 'enc:v1:';

// ADR 0005 (issue #382): formato versionado enc:v2:<keyId>:<base64>. Por ahora
// solo se lee; la escritura sigue siendo enc:v1 hasta T3b.
const MFA_SECRET_CIPHER_PREFIX_V2 = 'enc:v2:';

// Dedicated AES-256-GCM key (never shared with DOCUMENT_ENCRYPTION_KEY,
// GOOGLE_TOKEN_ENCRYPTION_KEY or PAYMENT_CREDENTIALS_ENCRYPTION_KEY), same
// payload scheme and startup validation as the other crypto services, via the
// primitives in common/crypto/aes-gcm.ts.
@Injectable()
export class MfaSecretCryptoService implements OnModuleInit {
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

  /** Encrypts a base32 TOTP secret into `enc:v1:<base64(iv|tag|ciphertext)>`. */
  encrypt(secret: string): string {
    // Read-only migration (ADR 0005, T3a): still writes enc:v1 with key id 0.
    const key = this.keyring.keys.get(0);
    if (!key) throw new Error(`${ENV_VAR_NAME}: keyring has no key id 0`);
    const payload = encryptAesGcm(Buffer.from(secret, 'utf8'), key);
    return `${MFA_SECRET_CIPHER_PREFIX}${payload.toString('base64')}`;
  }

  /**
   * Returns the plaintext base32 secret. Legacy plaintext values (no prefix)
   * pass through. A prefixed value that is tampered with or was encrypted
   * under another key throws (GCM authentication failure).
   */
  decrypt(stored: string): string {
    if (!this.isEncrypted(stored)) return stored;
    // enc:v1 is key id 0 and enc:v2 carries its key id; both go through the
    // keyring, which keeps the GCM authentication failure behavior.
    return decryptTextWithKeyring(stored, this.keyring).toString('utf8');
  }

  isEncrypted(stored: string): boolean {
    return (
      stored.startsWith(MFA_SECRET_CIPHER_PREFIX) ||
      stored.startsWith(MFA_SECRET_CIPHER_PREFIX_V2)
    );
  }
}
