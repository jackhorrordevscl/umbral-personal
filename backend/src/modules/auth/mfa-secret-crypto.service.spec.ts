import { ConfigService } from '@nestjs/config';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import {
  buildKeyring,
  decryptTextWithKeyring,
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

    expect(stored.startsWith('enc:v3:0:')).toBe(true);
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
    const [, , id, body] = stored.split(':');
    const payload = Buffer.from(body, 'base64');
    payload[payload.length - 1] ^= 0xff;

    expect(() =>
      service.decrypt(`enc:v3:${id}:${payload.toString('base64')}`),
    ).toThrow();
  });

  it('throws on a prefixed value that is not a valid payload', () => {
    const service = buildService(validKey);

    expect(() =>
      service.decrypt(`${MFA_SECRET_CIPHER_PREFIX}garbage`),
    ).toThrow();
    expect(() => service.decrypt(MFA_SECRET_CIPHER_PREFIX)).toThrow();
    expect(() => service.decrypt('enc:v3:0:garbage')).toThrow();
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

  // ADR 0005 (issue #382): el servicio lee enc:v1, enc:v2 y enc:v3 a través
  // del llavero, y escribe enc:v3 (con AAD) con la clave activa.
  describe('keyring reads (ADR 0005)', () => {
    const rotatedKey = Buffer.alloc(32, 99).toString('base64');
    const rotatedEnv = {
      MFA_SECRET_ENCRYPTION_KEY_KEYRING: `1:${rotatedKey}`,
      MFA_SECRET_ENCRYPTION_KEY_ACTIVE_KEY_ID: '1',
    };

    // enc:v2 (sin AAD) ya no se escribe desde el llavero (ahora emite
    // enc:v3), así que el valor se arma a mano con la primitiva.
    const v2Text = (id: number, keyBase64: string) =>
      `enc:v2:${id}:${encryptAesGcm(
        Buffer.from(secret),
        Buffer.from(keyBase64, 'base64'),
      ).toString('base64')}`;

    it('reads an enc:v2 value written with active key id 0', () => {
      const stored = v2Text(0, validKey);

      expect(buildService(validKey).decrypt(stored)).toBe(secret);
    });

    it('reads an enc:v2 value written with a rotated key (id 1)', () => {
      const stored = v2Text(1, rotatedKey);

      expect(buildService(validKey, rotatedEnv).decrypt(stored)).toBe(secret);
      expect(buildService(validKey, rotatedEnv).isEncrypted(stored)).toBe(true);
    });

    // U1 de T3b: el build debe leer enc:v3 (con AAD) antes de que U2 lo escriba.
    it('reads an enc:v3 value written with the mfa keyring (U1)', () => {
      const keyring = buildKeyring(
        validKey,
        rotatedEnv.MFA_SECRET_ENCRYPTION_KEY_KEYRING,
        rotatedEnv.MFA_SECRET_ENCRYPTION_KEY_ACTIVE_KEY_ID,
        'MFA_SECRET_ENCRYPTION_KEY',
      );
      const stored = encryptTextWithKeyring(Buffer.from(secret), keyring);
      const service = buildService(validKey, rotatedEnv);

      expect(stored.startsWith('enc:v3:')).toBe(true);
      expect(service.isEncrypted(stored)).toBe(true);
      expect(service.decrypt(stored)).toBe(secret);
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

    it('writes enc:v3 with key id 0 by default', () => {
      const stored = buildService(validKey).encrypt(secret);

      expect(stored.startsWith('enc:v3:0:')).toBe(true);
    });

    it('writes enc:v3 with the rotated active key (id 1) and reads it back', () => {
      const service = buildService(validKey, rotatedEnv);

      const stored = service.encrypt(secret);

      expect(stored.startsWith('enc:v3:1:')).toBe(true);
      expect(service.decrypt(stored)).toBe(secret);
    });

    it('reads what it wrote only with a service that shares the keyring', () => {
      const stored = buildService(validKey, rotatedEnv).encrypt(secret);

      expect(buildService(validKey, rotatedEnv).decrypt(stored)).toBe(secret);
      // Without key id 1 in the keyring there is no way to read it.
      expect(() => buildService(validKey).decrypt(stored)).toThrow();
    });

    it('does not read with another dataset label even with the same key', () => {
      const foreign = buildKeyring(
        validKey,
        undefined,
        undefined,
        'GOOGLE_TOKEN_ENCRYPTION_KEY',
      );
      const stored = buildService(validKey).encrypt(secret);

      expect(() => decryptTextWithKeyring(stored, foreign)).toThrow();
      expect(() =>
        buildService(validKey).decrypt(
          encryptTextWithKeyring(Buffer.from(secret), foreign),
        ),
      ).toThrow();
    });

    it('rejects an enc:v3 value whose key id was altered (the id is in the AAD)', () => {
      const stored = buildService(validKey, rotatedEnv).encrypt(secret);
      const altered = stored.replace('enc:v3:1:', 'enc:v3:0:');

      expect(() =>
        buildService(validKey, rotatedEnv).decrypt(altered),
      ).toThrow();
    });

    it('reads a mixed table of enc:v1, enc:v2, enc:v3 and plaintext rows', () => {
      const key = Buffer.from(validKey, 'base64');
      const service = buildService(validKey, rotatedEnv);
      const v1 = `${MFA_SECRET_CIPHER_PREFIX}${encryptAesGcm(
        Buffer.from(secret),
        key,
      ).toString('base64')}`;
      const rows = [v1, v2Text(0, validKey), service.encrypt(secret), secret];

      for (const row of rows) {
        expect(service.decrypt(row)).toBe(secret);
      }
    });

    it('throws on a tampered enc:v2 value (GCM authentication)', () => {
      const stored = v2Text(0, validKey);
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
