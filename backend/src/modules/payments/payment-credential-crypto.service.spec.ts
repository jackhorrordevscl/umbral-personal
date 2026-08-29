import { ConfigService } from '@nestjs/config';
import { PaymentCredentialCryptoService } from './payment-credential-crypto.service';

function buildService(key?: string): PaymentCredentialCryptoService {
  const config = { get: () => key } as unknown as ConfigService;
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
});
