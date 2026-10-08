import { ConfigService } from '@nestjs/config';
import { decryptAesGcm, encryptAesGcm } from '../../common/crypto/aes-gcm';
import { buildKeyring, encryptWithKeyring } from '../../common/crypto/keyring';
import { PaymentCredentialCryptoService } from './payment-credential-crypto.service';

function buildService(
  key?: string,
  extra: Record<string, string> = {},
): PaymentCredentialCryptoService {
  const values: Record<string, string | undefined> = {
    PAYMENT_CREDENTIALS_ENCRYPTION_KEY: key,
    ...extra,
  };
  const config = {
    get: (name: string) => values[name],
  } as unknown as ConfigService;
  const service = new PaymentCredentialCryptoService(config);
  service.onModuleInit();
  return service;
}

// sdd/online-payment-integration PR 2 (T5.1): mismo delegador fino que
// GoogleTokenCryptoService/DocumentEncryptionService sobre las primitivas
// AES-256-GCM compartidas (common/crypto/aes-gcm.ts), con su propia clave
// independiente (PAYMENT_CREDENTIALS_ENCRYPTION_KEY, ya validada en
// env.validation.ts desde PR 1).
describe('PaymentCredentialCryptoService', () => {
  const validKey = Buffer.alloc(32, 7).toString('base64');

  it('descifra exactamente el mismo payload que se cifró', () => {
    const service = buildService(validKey);
    const plaintext = Buffer.from(JSON.stringify({ merchantId: 'merchant-1' }));

    const encrypted = service.encrypt(plaintext);
    const decrypted = service.decrypt(encrypted);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('el payload cifrado no contiene el texto plano original', () => {
    const service = buildService(validKey);
    const plaintext = Buffer.from(JSON.stringify({ merchantId: 'merchant-2' }));

    const encrypted = service.encrypt(plaintext);

    expect(encrypted.includes(plaintext)).toBe(false);
  });

  it('falla al iniciar si PAYMENT_CREDENTIALS_ENCRYPTION_KEY no está definida', () => {
    expect(() => buildService(undefined)).toThrow(
      /PAYMENT_CREDENTIALS_ENCRYPTION_KEY/,
    );
  });

  it('falla al iniciar si la clave no decodifica a 32 bytes', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');
    expect(() => buildService(shortKey)).toThrow(
      /PAYMENT_CREDENTIALS_ENCRYPTION_KEY inválida/,
    );
  });

  it('no descifra un payload cifrado con una clave distinta', () => {
    const service = buildService(validKey);
    const otherService = buildService(Buffer.alloc(32, 9).toString('base64'));
    const encrypted = otherService.encrypt(Buffer.from('merchant-3'));

    expect(() => service.decrypt(encrypted)).toThrow();
  });

  // ADR 0005 (issue #382, T3a): migración de solo lectura. El servicio lee el
  // formato versionado y el legacy a través del llavero, pero sigue ESCRIBIENDO
  // el formato legacy hasta que T3b active la escritura versionada.
  describe('lectura por llavero (ADR 0005)', () => {
    const rotatedKey = Buffer.alloc(32, 99).toString('base64');
    const rotatedEnv = {
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY_KEYRING: `1:${rotatedKey}`,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY_ACTIVE_KEY_ID: '1',
    };
    const plaintext = Buffer.from('merchant-1');

    it('lee un payload versionado con la clave activa id 0', () => {
      const keyring = buildKeyring(
        validKey,
        undefined,
        undefined,
        'PAYMENT_CREDENTIALS_ENCRYPTION_KEY',
      );
      const payload = encryptWithKeyring(plaintext, keyring);

      expect(buildService(validKey).decrypt(payload).equals(plaintext)).toBe(
        true,
      );
    });

    it('lee un payload versionado con una clave rotada (id 1)', () => {
      const keyring = buildKeyring(
        validKey,
        rotatedEnv.PAYMENT_CREDENTIALS_ENCRYPTION_KEY_KEYRING,
        rotatedEnv.PAYMENT_CREDENTIALS_ENCRYPTION_KEY_ACTIVE_KEY_ID,
        'PAYMENT_CREDENTIALS_ENCRYPTION_KEY',
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
