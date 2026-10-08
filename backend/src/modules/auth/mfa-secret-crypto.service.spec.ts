import { ConfigService } from '@nestjs/config';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import {
  buildKeyring,
  encryptTextWithKeyring,
} from '../../common/crypto/keyring';
import {
  MFA_SECRET_CIPHER_PREFIX,
  MfaSecretCryptoService,
} from './mfa-secret-crypto.service';

function buildService(
  key?: string,
  extra: Record<string, string> = {},
): MfaSecretCryptoService {
  const values: Record<string, string | undefined> = {
    MFA_SECRET_ENCRYPTION_KEY: key,
    ...extra,
  };
  const config = {
    get: (name: string) => values[name],
  } as unknown as ConfigService;
  const service = new MfaSecretCryptoService(config);
  service.onModuleInit();
  return service;
}

// Issue #302 (part 2): TOTP secret encrypted at rest with its own AES-256-GCM
// key. Legacy plaintext rows (no prefix) must keep decrypting.
describe('MfaSecretCryptoService', () => {
  const validKey = Buffer.alloc(32, 7).toString('base64');
  const secret = 'JBSWY3DPEHPK3PXP';

  it('round trips a secret through the versioned ciphertext', () => {
    const service = buildService(validKey);

    const stored = service.encrypt(secret);

    expect(stored.startsWith(MFA_SECRET_CIPHER_PREFIX)).toBe(true);
    expect(service.isEncrypted(stored)).toBe(true);
    expect(service.decrypt(stored)).toBe(secret);
  });

  it('does not leak the plaintext and uses a fresh IV per call', () => {
    const service = buildService(validKey);

    const first = service.encrypt(secret);
    const second = service.encrypt(secret);

    expect(first).not.toContain(secret);
    expect(first).not.toBe(second);
  });

  it('passes legacy plaintext (no prefix) through unchanged', () => {
    const service = buildService(validKey);

    expect(service.isEncrypted(secret)).toBe(false);
    expect(service.decrypt(secret)).toBe(secret);
  });

  it('throws on a tampered ciphertext (GCM authentication)', () => {
    const service = buildService(validKey);
    const stored = service.encrypt(secret);
    const payload = Buffer.from(
      stored.slice(MFA_SECRET_CIPHER_PREFIX.length),
      'base64',
    );
    payload[payload.length - 1] ^= 0xff;

    expect(() =>
      service.decrypt(
        `${MFA_SECRET_CIPHER_PREFIX}${payload.toString('base64')}`,
      ),
    ).toThrow();
  });

  it('throws on a prefixed value that is not a valid payload', () => {
    const service = buildService(validKey);

    expect(() =>
      service.decrypt(`${MFA_SECRET_CIPHER_PREFIX}garbage`),
    ).toThrow();
    expect(() => service.decrypt(MFA_SECRET_CIPHER_PREFIX)).toThrow();
  });

  it('does not decrypt a value encrypted under a different key', () => {
    const service = buildService(validKey);
    const other = buildService(Buffer.alloc(32, 9).toString('base64'));

    expect(() => service.decrypt(other.encrypt(secret))).toThrow();
  });

  it('fails at startup if MFA_SECRET_ENCRYPTION_KEY is missing', () => {
    expect(() => buildService(undefined)).toThrow(/MFA_SECRET_ENCRYPTION_KEY/);
  });

  it('fails at startup if the key does not decode to 32 bytes', () => {
    expect(() => buildService(Buffer.alloc(16, 1).toString('base64'))).toThrow(
      /MFA_SECRET_ENCRYPTION_KEY inválida/,
    );
  });

  // ADR 0005 (issue #382, T3a): migración de solo lectura. El servicio lee
  // enc:v1 y enc:v2 a través del llavero, pero sigue escribiendo enc:v1 hasta
  // que T3b active la escritura versionada.
  describe('keyring reads (ADR 0005)', () => {
    const rotatedKey = Buffer.alloc(32, 99).toString('base64');
    const rotatedEnv = {
      MFA_SECRET_ENCRYPTION_KEY_KEYRING: `1:${rotatedKey}`,
      MFA_SECRET_ENCRYPTION_KEY_ACTIVE_KEY_ID: '1',
    };

    it('reads an enc:v2 value written with active key id 0', () => {
      const keyring = buildKeyring(
        validKey,
        undefined,
        undefined,
        'MFA_SECRET_ENCRYPTION_KEY',
      );
      const stored = encryptTextWithKeyring(Buffer.from(secret), keyring);

      expect(stored.startsWith('enc:v2:0:')).toBe(true);
      expect(buildService(validKey).decrypt(stored)).toBe(secret);
    });

    it('reads an enc:v2 value written with a rotated key (id 1)', () => {
      const keyring = buildKeyring(
        validKey,
        rotatedEnv.MFA_SECRET_ENCRYPTION_KEY_KEYRING,
        rotatedEnv.MFA_SECRET_ENCRYPTION_KEY_ACTIVE_KEY_ID,
        'MFA_SECRET_ENCRYPTION_KEY',
      );
      const stored = encryptTextWithKeyring(Buffer.from(secret), keyring);

      expect(stored.startsWith('enc:v2:1:')).toBe(true);
      expect(buildService(validKey, rotatedEnv).decrypt(stored)).toBe(secret);
      expect(buildService(validKey, rotatedEnv).isEncrypted(stored)).toBe(true);
    });

    it('still reads enc:v1 and legacy plaintext with a keyring configured', () => {
      const service = buildService(validKey, rotatedEnv);
      const v1 = `${MFA_SECRET_CIPHER_PREFIX}${encryptAesGcm(
        Buffer.from(secret),
        Buffer.from(validKey, 'base64'),
      ).toString('base64')}`;

      expect(service.decrypt(v1)).toBe(secret);
      expect(service.decrypt(secret)).toBe(secret);
    });

    it('still writes enc:v1 even with a rotated active key', () => {
      const stored = buildService(validKey, rotatedEnv).encrypt(secret);

      expect(stored.startsWith('enc:v1:')).toBe(true);
      expect(stored.startsWith('enc:v2:')).toBe(false);
    });

    it('throws on a tampered enc:v2 value (GCM authentication)', () => {
      const keyring = buildKeyring(
        validKey,
        undefined,
        undefined,
        'MFA_SECRET_ENCRYPTION_KEY',
      );
      const stored = encryptTextWithKeyring(Buffer.from(secret), keyring);
      const [, , id, body] = stored.split(':');
      const payload = Buffer.from(body, 'base64');
      payload[payload.length - 1] ^= 0xff;

      expect(() =>
        buildService(validKey).decrypt(
          `enc:v2:${id}:${payload.toString('base64')}`,
        ),
      ).toThrow();
    });
  });
});
