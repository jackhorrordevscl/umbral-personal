import { ConfigService } from '@nestjs/config';
import { GoogleTokenCryptoService } from './google-token-crypto.service';

function buildService(key?: string): GoogleTokenCryptoService {
  const config = { get: () => key } as unknown as ConfigService;
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
});
