import { ConfigService } from '@nestjs/config';
import { DocumentEncryptionService } from './document-encryption.service';

function buildService(key?: string): DocumentEncryptionService {
  const config = { get: () => key } as unknown as ConfigService;
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
});
