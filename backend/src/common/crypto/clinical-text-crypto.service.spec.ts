import { ConfigService } from '@nestjs/config';
import { buildKeyring, encryptTextWithKeyring } from './keyring';
import { ClinicalTextCryptoService } from './clinical-text-crypto.service';

function buildService(
  key?: string,
  extra: Record<string, string> = {},
): ClinicalTextCryptoService {
  const values: Record<string, string | undefined> = {
    CLINICAL_TEXT_ENCRYPTION_KEY: key,
    ...extra,
  };
  const config = {
    get: (name: string) => values[name],
  } as unknown as ConfigService;
  const service = new ClinicalTextCryptoService(config);
  service.onModuleInit();
  return service;
}

// ADR 0004 (opción B): los textos clínicos libres se cifran a nivel de
// aplicación con una clave propia (dataset "clinical"), formato enc:v3.
describe('ClinicalTextCryptoService', () => {
  const validKey = Buffer.alloc(32, 9).toString('base64');
  const otherKey = Buffer.alloc(32, 3).toString('base64');
  const note = '<p>Paciente refiere ansiedad &amp; insomnio.</p>';

  it('round trips a clinical text through the versioned ciphertext', () => {
    const service = buildService(validKey);

    const stored = service.encrypt(note);

    expect(stored.startsWith('enc:v3:0:')).toBe(true);
    expect(service.isEncrypted(stored)).toBe(true);
    expect(service.decrypt(stored)).toBe(note);
  });

  it('does not leak the plaintext and uses a fresh IV per call', () => {
    const service = buildService(validKey);

    const first = service.encrypt(note);
    const second = service.encrypt(note);

    expect(first).not.toContain('ansiedad');
    expect(first).not.toBe(second);
  });

  it('round trips the empty string (discharge fields default to "")', () => {
    const service = buildService(validKey);

    const stored = service.encrypt('');

    expect(service.isEncrypted(stored)).toBe(true);
    expect(service.decrypt(stored)).toBe('');
  });

  it('passes legacy plaintext (no prefix) through decrypt untouched', () => {
    const service = buildService(validKey);

    expect(service.decrypt('texto sin cifrar')).toBe('texto sin cifrar');
    expect(service.isEncrypted('texto sin cifrar')).toBe(false);
  });

  it('throws when the ciphertext was tampered with', () => {
    const service = buildService(validKey);
    const stored = service.encrypt(note);
    const tampered = `${stored.slice(0, -4)}AAAA`;

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('throws when the ciphertext was encrypted under another key', () => {
    const stored = buildService(otherKey).encrypt(note);

    expect(() => buildService(validKey).decrypt(stored)).toThrow();
  });

  it('rejects a ciphertext moved from another dataset (AAD dataset label)', () => {
    // Misma clave, otro dataset: el AAD incluye la etiqueta, así que no
    // descifra como "clinical".
    const mfaKeyring = buildKeyring(
      validKey,
      undefined,
      undefined,
      'MFA_SECRET_ENCRYPTION_KEY',
    );
    const foreign = encryptTextWithKeyring(Buffer.from(note), mfaKeyring);

    expect(() => buildService(validKey).decrypt(foreign)).toThrow();
  });

  it('encrypts with the active key of the keyring and still reads older ids', () => {
    const rotated = buildService(validKey, {
      CLINICAL_TEXT_ENCRYPTION_KEY_KEYRING: `1:${otherKey}`,
      CLINICAL_TEXT_ENCRYPTION_KEY_ACTIVE_KEY_ID: '1',
    });
    const oldStored = buildService(validKey).encrypt(note);

    const fresh = rotated.encrypt(note);

    expect(fresh.startsWith('enc:v3:1:')).toBe(true);
    expect(rotated.decrypt(fresh)).toBe(note);
    expect(rotated.decrypt(oldStored)).toBe(note);
  });

  it('fails at startup when the key is missing or malformed', () => {
    expect(() => buildService(undefined)).toThrow(
      /CLINICAL_TEXT_ENCRYPTION_KEY/,
    );
    expect(() => buildService('no-es-base64-de-32-bytes')).toThrow(
      /CLINICAL_TEXT_ENCRYPTION_KEY/,
    );
  });

  describe('nullable helpers', () => {
    it('keeps null and undefined as null for encryptNullable and decryptNullable', () => {
      const service = buildService(validKey);

      expect(service.encryptNullable(null)).toBeNull();
      expect(service.encryptNullable(undefined)).toBeNull();
      expect(service.decryptNullable(null)).toBeNull();
      expect(service.decryptNullable(undefined)).toBeNull();
    });

    it('encrypts and decrypts present values', () => {
      const service = buildService(validKey);

      const stored = service.encryptNullable(note);

      expect(stored).not.toBeNull();
      expect(service.isEncrypted(stored as string)).toBe(true);
      expect(service.decryptNullable(stored)).toBe(note);
    });
  });
});
