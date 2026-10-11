import { ConfigService } from '@nestjs/config';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import {
  buildKeyring,
  decryptWithKeyring,
  encryptWithKeyring,
} from '../../common/crypto/keyring';
import { GoogleTokenCryptoService } from './google-token-crypto.service';

function buildService(
  key?: string,
  extra: Record<string, string> = {},
): GoogleTokenCryptoService {
  const values: Record<string, string | undefined> = {
    GOOGLE_TOKEN_ENCRYPTION_KEY: key,
    ...extra,
  };
  const config = {
    get: (name: string) => values[name],
  } as unknown as ConfigService;
  const service = new GoogleTokenCryptoService(config);
  service.onModuleInit();
  return service;
}

describe('GoogleTokenCryptoService', () => {
  const validKey = Buffer.alloc(32, 5).toString('base64');

  it('descifra exactamente el mismo refresh token que se cifró', () => {
    const service = buildService(validKey);
    const plaintext = Buffer.from('1//refresh-token-de-prueba-google');

    const encrypted = service.encrypt(plaintext);
    const decrypted = service.decrypt(encrypted);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('el refresh token cifrado no contiene el texto plano original', () => {
    const service = buildService(validKey);
    const plaintext = Buffer.from('1//otro-refresh-token-distinto');

    const encrypted = service.encrypt(plaintext);

    expect(encrypted.includes(plaintext)).toBe(false);
  });

  it('falla al iniciar si GOOGLE_TOKEN_ENCRYPTION_KEY no está definida', () => {
    expect(() => buildService(undefined)).toThrow(
      /GOOGLE_TOKEN_ENCRYPTION_KEY/,
    );
  });

  it('falla al iniciar si la clave no decodifica a 32 bytes', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');
    expect(() => buildService(shortKey)).toThrow(
      /GOOGLE_TOKEN_ENCRYPTION_KEY inválida/,
    );
  });

  // Distingue esta clave de DOCUMENT_ENCRYPTION_KEY (design.md "Dedicated
  // GOOGLE_TOKEN_ENCRYPTION_KEY, not DOCUMENT_ENCRYPTION_KEY"): un payload
  // cifrado con la clave de documentos nunca debe descifrar con esta.
  it('no descifra un payload cifrado con una clave distinta', () => {
    const service = buildService(validKey);
    const otherService = buildService(Buffer.alloc(32, 8).toString('base64'));
    const encrypted = otherService.encrypt(Buffer.from('token'));

    expect(() => service.decrypt(encrypted)).toThrow();
  });

  // ADR 0005 (issue #382, T3a): migración de solo lectura. El servicio lee el
  // formato versionado y el legacy a través del llavero, pero sigue ESCRIBIENDO
  // el formato legacy hasta que T3b active la escritura versionada.
  describe('lectura por llavero (ADR 0005)', () => {
    const rotatedKey = Buffer.alloc(32, 99).toString('base64');
    const rotatedEnv = {
      GOOGLE_TOKEN_ENCRYPTION_KEY_KEYRING: `1:${rotatedKey}`,
      GOOGLE_TOKEN_ENCRYPTION_KEY_ACTIVE_KEY_ID: '1',
    };
    const plaintext = Buffer.from('1//refresh-token');

    it('lee un payload versionado con la clave activa id 0', () => {
      const keyring = buildKeyring(
        validKey,
        undefined,
        undefined,
        'GOOGLE_TOKEN_ENCRYPTION_KEY',
      );
      const payload = encryptWithKeyring(plaintext, keyring);

      expect(buildService(validKey).decrypt(payload).equals(plaintext)).toBe(
        true,
      );
    });

    it('lee un payload versionado con una clave rotada (id 1)', () => {
      const keyring = buildKeyring(
        validKey,
        rotatedEnv.GOOGLE_TOKEN_ENCRYPTION_KEY_KEYRING,
        rotatedEnv.GOOGLE_TOKEN_ENCRYPTION_KEY_ACTIVE_KEY_ID,
        'GOOGLE_TOKEN_ENCRYPTION_KEY',
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

    it('escribe el formato 0x02 con la clave id 0 por defecto', () => {
      const encrypted = buildService(validKey).encrypt(plaintext);

      expect([...encrypted.subarray(0, 4)]).toEqual([0x55, 0x4b, 0x02, 0]);
      // Cabecera (4) + IV (12) + tag (16) + ciphertext.
      expect(encrypted.length).toBe(plaintext.length + 32);
    });

    it('escribe 0x02 con la clave activa rotada (id 1) y la lee de vuelta', () => {
      const service = buildService(validKey, rotatedEnv);

      const encrypted = service.encrypt(plaintext);

      expect([...encrypted.subarray(0, 4)]).toEqual([0x55, 0x4b, 0x02, 1]);
      expect(service.decrypt(encrypted).equals(plaintext)).toBe(true);
    });

    it('lo escrito solo se lee con un servicio que comparte el llavero', () => {
      const encrypted = buildService(validKey, rotatedEnv).encrypt(plaintext);

      expect(
        buildService(validKey, rotatedEnv).decrypt(encrypted).equals(plaintext),
      ).toBe(true);
      // Sin la clave id 1 en el llavero no hay forma de leerlo.
      expect(() => buildService(validKey).decrypt(encrypted)).toThrow();
    });

    it('no se lee con otra etiqueta de dataset aunque la clave sea la misma', () => {
      const foreign = buildKeyring(
        validKey,
        undefined,
        undefined,
        'DOCUMENT_ENCRYPTION_KEY',
      );
      const encrypted = buildService(validKey).encrypt(plaintext);

      expect(() => decryptWithKeyring(encrypted, foreign)).toThrow();
      expect(() =>
        buildService(validKey).decrypt(encryptWithKeyring(plaintext, foreign)),
      ).toThrow();
    });

    it('rechaza una cabecera 0x02 alterada (el keyId entra al AAD)', () => {
      const encrypted = buildService(validKey, rotatedEnv).encrypt(plaintext);
      encrypted[3] = 0; // dice id 0, pero se cifró con la clave id 1

      expect(() =>
        buildService(validKey, rotatedEnv).decrypt(encrypted),
      ).toThrow();
    });

    it('lee una tabla mezclada con filas legacy, 0x01 y 0x02', () => {
      const key = Buffer.from(validKey, 'base64');
      const legacy = encryptAesGcm(plaintext, key);
      const v1 = Buffer.concat([
        Buffer.from([0x55, 0x4b, 0x01, 0]),
        encryptAesGcm(plaintext, key),
      ]);
      const service = buildService(validKey, rotatedEnv);
      const v2 = service.encrypt(plaintext);

      for (const row of [legacy, v1, v2]) {
        expect(service.decrypt(row).equals(plaintext)).toBe(true);
      }
    });
  });
});
