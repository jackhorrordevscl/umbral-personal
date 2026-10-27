import { ConfigService } from '@nestjs/config';
import { buildKeyring, encryptTextWithKeyring } from './keyring';
import {
  ClinicalTextCryptoService,
  clinicalContext,
} from './clinical-text-crypto.service';

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
// aplicación con una clave propia (dataset "clinical"), formato enc:v4 ligado
// al dueño y al campo (issue #486).
describe('ClinicalTextCryptoService', () => {
  const validKey = Buffer.alloc(32, 9).toString('base64');
  const otherKey = Buffer.alloc(32, 3).toString('base64');
  const note = '<p>Paciente refiere ansiedad &amp; insomnio.</p>';
  const ctx = clinicalContext('patient', 'p-1', 'consultation.consultReason');

  it('round trips a clinical text through the versioned ciphertext', () => {
    const service = buildService(validKey);

    const stored = service.encrypt(note, ctx);

    expect(stored.startsWith('enc:v4:0:')).toBe(true);
    expect(service.isEncrypted(stored)).toBe(true);
    expect(service.decrypt(stored, ctx)).toBe(note);
  });

  it('does not leak the plaintext and uses a fresh IV per call', () => {
    const service = buildService(validKey);

    const first = service.encrypt(note, ctx);
    const second = service.encrypt(note, ctx);

    expect(first).not.toContain('ansiedad');
    expect(first).not.toBe(second);
  });

  it('round trips the empty string (discharge fields default to "")', () => {
    const service = buildService(validKey);

    const stored = service.encrypt('', ctx);

    expect(service.isEncrypted(stored)).toBe(true);
    expect(service.decrypt(stored, ctx)).toBe('');
  });

  it('passes legacy plaintext (no prefix) through decrypt untouched', () => {
    const service = buildService(validKey);

    expect(service.decrypt('texto sin cifrar', ctx)).toBe('texto sin cifrar');
    expect(service.isEncrypted('texto sin cifrar')).toBe(false);
  });

  it('throws when the ciphertext was tampered with', () => {
    const service = buildService(validKey);
    const stored = service.encrypt(note, ctx);
    const tampered = `${stored.slice(0, -4)}AAAA`;

    expect(() => service.decrypt(tampered, ctx)).toThrow();
  });

  it('throws when the ciphertext was encrypted under another key', () => {
    const stored = buildService(otherKey).encrypt(note, ctx);

    expect(() => buildService(validKey).decrypt(stored, ctx)).toThrow();
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
    const foreign = encryptTextWithKeyring(Buffer.from(note), mfaKeyring, ctx);

    expect(() => buildService(validKey).decrypt(foreign, ctx)).toThrow();
  });

  it('encrypts with the active key of the keyring and still reads older ids', () => {
    const rotated = buildService(validKey, {
      CLINICAL_TEXT_ENCRYPTION_KEY_KEYRING: `1:${otherKey}`,
      CLINICAL_TEXT_ENCRYPTION_KEY_ACTIVE_KEY_ID: '1',
    });
    const oldStored = buildService(validKey).encrypt(note, ctx);

    const fresh = rotated.encrypt(note, ctx);

    expect(fresh.startsWith('enc:v4:1:')).toBe(true);
    expect(rotated.decrypt(fresh, ctx)).toBe(note);
    expect(rotated.decrypt(oldStored, ctx)).toBe(note);
  });

  it('fails at startup when the key is missing or malformed', () => {
    expect(() => buildService(undefined)).toThrow(
      /CLINICAL_TEXT_ENCRYPTION_KEY/,
    );
    expect(() => buildService('no-es-base64-de-32-bytes')).toThrow(
      /CLINICAL_TEXT_ENCRYPTION_KEY/,
    );
  });

  // issue #486: quien tenga escritura en la base no puede copiar un texto
  // cifrado a otro paciente, a otro campo o a otro usuario.
  describe('binding to the owner and the field (issue #486)', () => {
    it('does not decrypt a text copied to another patient', () => {
      const service = buildService(validKey);
      const stored = service.encrypt(note, ctx);

      expect(() =>
        service.decrypt(
          stored,
          clinicalContext('patient', 'p-2', 'consultation.consultReason'),
        ),
      ).toThrow();
    });

    it('does not decrypt a text copied to another field', () => {
      const service = buildService(validKey);
      const stored = service.encrypt(note, ctx);

      expect(() =>
        service.decrypt(
          stored,
          clinicalContext('patient', 'p-1', 'consultation.intervention'),
        ),
      ).toThrow();
    });

    it('does not decrypt a text copied between a consultation and a discharge of the same patient', () => {
      const service = buildService(validKey);
      const stored = service.encrypt(note, ctx);

      expect(() =>
        service.decrypt(
          stored,
          clinicalContext('patient', 'p-1', 'discharge.consultReason'),
        ),
      ).toThrow();
    });

    it('does not decrypt a text copied to another user (notifications)', () => {
      const service = buildService(validKey);
      const stored = service.encrypt(
        note,
        clinicalContext('user', 'u-1', 'notification.title'),
      );

      expect(() =>
        service.decrypt(
          stored,
          clinicalContext('user', 'u-2', 'notification.title'),
        ),
      ).toThrow();
    });

    it('does not mix an owner of one scope with the same id in another scope', () => {
      const service = buildService(validKey);
      const stored = service.encrypt(
        note,
        clinicalContext('patient', 'x-1', 'notification.title'),
      );

      expect(() =>
        service.decrypt(
          stored,
          clinicalContext('user', 'x-1', 'notification.title'),
        ),
      ).toThrow();
    });

    it('still reads a legacy enc:v3 text regardless of the context', () => {
      const service = buildService(validKey);
      const keyring = buildKeyring(
        validKey,
        undefined,
        undefined,
        'CLINICAL_TEXT_ENCRYPTION_KEY',
      );
      const legacy = encryptTextWithKeyring(Buffer.from(note), keyring);

      expect(legacy.startsWith('enc:v3:0:')).toBe(true);
      expect(service.decrypt(legacy, ctx)).toBe(note);
    });

    it('refuses to build a context without owner or field', () => {
      expect(() => clinicalContext('patient', '', 'consultation.x')).toThrow(
        /dueño y campo/,
      );
      expect(() => clinicalContext('patient', 'p-1', '')).toThrow(
        /dueño y campo/,
      );
    });
  });

  describe('nullable helpers', () => {
    it('keeps null and undefined as null for encryptNullable and decryptNullable', () => {
      const service = buildService(validKey);

      expect(service.encryptNullable(null, ctx)).toBeNull();
      expect(service.encryptNullable(undefined, ctx)).toBeNull();
      expect(service.decryptNullable(null, ctx)).toBeNull();
      expect(service.decryptNullable(undefined, ctx)).toBeNull();
    });

    it('encrypts and decrypts present values', () => {
      const service = buildService(validKey);

      const stored = service.encryptNullable(note, ctx);

      expect(stored).not.toBeNull();
      expect(service.isEncrypted(stored as string)).toBe(true);
      expect(service.decryptNullable(stored, ctx)).toBe(note);
    });
  });
});
