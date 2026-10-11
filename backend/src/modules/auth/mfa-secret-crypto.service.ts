import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildKeyring,
  decryptTextWithKeyring,
  encryptTextWithKeyring,
  Keyring,
} from '../../common/crypto/keyring';

const ENV_VAR_NAME = 'MFA_SECRET_ENCRYPTION_KEY';

// Issue #302 (part 2): versioned prefix of the stored value. A TOTP secret is
// base32 (A-Z, 2-7), so it can never contain ':' -- a value without this
// prefix is unambiguously a legacy plaintext secret written before the
// encryption at rest, and is passed through untouched by decrypt().
export const MFA_SECRET_CIPHER_PREFIX = 'enc:v1:'; // legacy: solo se lee

// ADR 0005 (issue #382): formato versionado enc:v2:<keyId>:<base64>. Solo se
// lee: ya no se escribe.
const MFA_SECRET_CIPHER_PREFIX_V2 = 'enc:v2:';

// ADR 0005 (issue #382): enc:v3:<keyId>:<base64> agrega AAD (prefijo, keyId y
// dataset autenticados). Es el formato que escribe encrypt() desde T3b.
const MFA_SECRET_CIPHER_PREFIX_V3 = 'enc:v3:';

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

  /**
   * Encrypts a base32 TOTP secret into `enc:v3:<keyId>:<base64(iv|tag|ct)>`
   * with the active key of the keyring (id 0 by default). The key id and the
   * dataset label are authenticated (AAD), so a value moved to another dataset
   * or with an altered key id fails to decrypt.
   */
  encrypt(secret: string): string {
    return encryptTextWithKeyring(Buffer.from(secret, 'utf8'), this.keyring);
  }

  /**
   * Returns the plaintext base32 secret. Legacy plaintext values (no prefix)
   * pass through. A prefixed value that is tampered with or was encrypted
   * under another key throws (GCM authentication failure).
   */
  decrypt(stored: string): string {
    if (!this.isEncrypted(stored)) return stored;
    // enc:v1 is key id 0; enc:v2 and enc:v3 carry their key id. All go through
    // the keyring, which keeps the GCM authentication failure behavior.
    return decryptTextWithKeyring(stored, this.keyring).toString('utf8');
  }

  isEncrypted(stored: string): boolean {
    return (
      stored.startsWith(MFA_SECRET_CIPHER_PREFIX) ||
      stored.startsWith(MFA_SECRET_CIPHER_PREFIX_V2) ||
      stored.startsWith(MFA_SECRET_CIPHER_PREFIX_V3)
    );
  }
}
