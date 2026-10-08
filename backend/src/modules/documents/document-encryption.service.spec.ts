import { ConfigService } from '@nestjs/config';
import { decryptAesGcm, encryptAesGcm } from '../../common/crypto/aes-gcm';
import { buildKeyring, encryptWithKeyring } from '../../common/crypto/keyring';
import { DocumentEncryptionService } from './document-encryption.service';

function buildService(
  key?: string,
  extra: Record<string, string> = {},
): DocumentEncryptionService {
  const values: Record<string, string | undefined> = {
    DOCUMENT_ENCRYPTION_KEY: key,
    ...extra,
  };
  const config = {
    get: (name: string) => values[name],
  } as unknown as ConfigService;
  const service = new DocumentEncryptionService(config);
  service.onModuleInit();
  return service;
}

describe('DocumentEncryptionService', () => {
  const validKey = Buffer.alloc(32, 9).toString('base64');

  it('descifra exactamente el mismo contenido que se cifró', () => {
    const service = buildService(validKey);
    const plaintext = Buffer.from('informe clínico confidencial');

    const encrypted = service.encrypt(plaintext);
    const decrypted = service.decrypt(encrypted);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('el contenido cifrado no contiene el texto plano original', () => {
    const service = buildService(validKey);
    const plaintext = Buffer.from('dato-sensible-no-deberia-aparecer-asi');

    const encrypted = service.encrypt(plaintext);

    expect(encrypted.includes(plaintext)).toBe(false);
  });

  it('dos cifrados del mismo contenido dan resultados distintos (IV aleatorio)', () => {
    const service = buildService(validKey);
    const plaintext = Buffer.from('mismo contenido');

    const first = service.encrypt(plaintext);
    const second = service.encrypt(plaintext);

    expect(first.equals(second)).toBe(false);
  });

  it('rechaza descifrar si el payload fue alterado (auth tag no coincide)', () => {
    const service = buildService(validKey);
    const encrypted = service.encrypt(Buffer.from('contenido original'));
    encrypted[encrypted.length - 1] ^= 0xff; // corrompe el último byte del ciphertext

    expect(() => service.decrypt(encrypted)).toThrow();
  });

  it('falla al iniciar si DOCUMENT_ENCRYPTION_KEY no está definida', () => {
    expect(() => buildService(undefined)).toThrow(/DOCUMENT_ENCRYPTION_KEY/);
  });

  it('falla al iniciar si la clave no decodifica a 32 bytes', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');
    expect(() => buildService(shortKey)).toThrow(
      /DOCUMENT_ENCRYPTION_KEY inválida/,
    );
  });

  // ADR 0005 (issue #382, T3a): migración de solo lectura. El servicio lee el
  // formato versionado y el legacy a través del llavero, pero sigue ESCRIBIENDO
  // el formato legacy hasta que T3b active la escritura versionada.
  describe('lectura por llavero (ADR 0005)', () => {
    const rotatedKey = Buffer.alloc(32, 99).toString('base64');
    const rotatedEnv = {
      DOCUMENT_ENCRYPTION_KEY_KEYRING: `1:${rotatedKey}`,
      DOCUMENT_ENCRYPTION_KEY_ACTIVE_KEY_ID: '1',
    };
    const plaintext = Buffer.from('informe clínico');

    it('lee un payload versionado con la clave activa id 0', () => {
      const keyring = buildKeyring(
        validKey,
        undefined,
        undefined,
        'DOCUMENT_ENCRYPTION_KEY',
      );
      const payload = encryptWithKeyring(plaintext, keyring);

      expect(buildService(validKey).decrypt(payload).equals(plaintext)).toBe(
        true,
      );
    });

    it('lee un payload versionado con una clave rotada (id 1)', () => {
      const keyring = buildKeyring(
        validKey,
        rotatedEnv.DOCUMENT_ENCRYPTION_KEY_KEYRING,
        rotatedEnv.DOCUMENT_ENCRYPTION_KEY_ACTIVE_KEY_ID,
        'DOCUMENT_ENCRYPTION_KEY',
      );
      const payload = encryptWithKeyring(plaintext, keyring);
      const service = buildService(validKey, rotatedEnv);

      expect(service.decrypt(payload).equals(plaintext)).toBe(true);
    });

    it('sigue leyendo un payload legacy con el llavero configurado', () => {
      const legacy = encryptAesGcm(plaintext, Buffer.from(validKey, 'base64'));

      expect(
        buildService(validKey, rotatedEnv).decrypt(legacy).equals(plaintext),
      ).toBe(true);
    });

    it('sigue escribiendo el formato legacy aunque haya clave activa rotada', () => {
      const service = buildService(validKey, rotatedEnv);

      const encrypted = service.encrypt(plaintext);

      // Layout legacy puro [IV12][tag16][ct]: sin cabecera de 4 bytes y
      // descifrable directamente con la clave id 0.
      expect(encrypted.length).toBe(plaintext.length + 28);
      expect(
        decryptAesGcm(encrypted, Buffer.from(validKey, 'base64')).equals(
          plaintext,
        ),
      ).toBe(true);
    });
  });
});
