import { ConfigService } from '@nestjs/config';
import { decryptAesGcm, encryptAesGcm } from '../../common/crypto/aes-gcm';
import { buildKeyring, encryptWithKeyring } from '../../common/crypto/keyring';
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
