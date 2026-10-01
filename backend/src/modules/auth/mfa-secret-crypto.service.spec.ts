import { ConfigService } from '@nestjs/config';
import {
  MFA_SECRET_CIPHER_PREFIX,
  MfaSecretCryptoService,
} from './mfa-secret-crypto.service';

function buildService(key?: string): MfaSecretCryptoService {
  const config = { get: () => key } as unknown as ConfigService;
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
});
