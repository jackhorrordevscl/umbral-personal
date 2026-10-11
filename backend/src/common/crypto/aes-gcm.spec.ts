import { decryptAesGcm, encryptAesGcm, loadBase64Key } from './aes-gcm';

describe('aes-gcm', () => {
  const validKey = Buffer.alloc(32, 3);

  describe('encryptAesGcm / decryptAesGcm', () => {
    it('descifra exactamente el mismo contenido que se cifró', () => {
      const plaintext = Buffer.from('refresh-token-de-prueba');

      const encrypted = encryptAesGcm(plaintext, validKey);
      const decrypted = decryptAesGcm(encrypted, validKey);

      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('el contenido cifrado no contiene el texto plano original', () => {
      const plaintext = Buffer.from('otro-secreto-distinto');

      const encrypted = encryptAesGcm(plaintext, validKey);

      expect(encrypted.includes(plaintext)).toBe(false);
    });

    it('dos cifrados del mismo contenido dan resultados distintos (IV aleatorio)', () => {
      const plaintext = Buffer.from('mismo contenido');

      const first = encryptAesGcm(plaintext, validKey);
      const second = encryptAesGcm(plaintext, validKey);

      expect(first.equals(second)).toBe(false);
    });

    it('rechaza descifrar si el payload fue alterado (auth tag no coincide)', () => {
      const encrypted = encryptAesGcm(
        Buffer.from('contenido original'),
        validKey,
      );
      encrypted[encrypted.length - 1] ^= 0xff;

      expect(() => decryptAesGcm(encrypted, validKey)).toThrow();
    });

    it('no descifra con una clave distinta a la usada para cifrar', () => {
      const otherKey = Buffer.alloc(32, 9);
      const encrypted = encryptAesGcm(Buffer.from('contenido'), validKey);

      expect(() => decryptAesGcm(encrypted, otherKey)).toThrow();
    });
  });

  describe('AAD y largo de tag', () => {
    const aad = Buffer.from('cabecera-y-dataset');

    it('hace roundtrip con el mismo AAD', () => {
      const plaintext = Buffer.from('con aad');

      const encrypted = encryptAesGcm(plaintext, validKey, aad);

      expect(decryptAesGcm(encrypted, validKey, aad).equals(plaintext)).toBe(
        true,
      );
    });

    it('rechaza descifrar con un AAD distinto o ausente', () => {
      const encrypted = encryptAesGcm(Buffer.from('con aad'), validKey, aad);

      expect(() =>
        decryptAesGcm(encrypted, validKey, Buffer.from('otro')),
      ).toThrow();
      expect(() => decryptAesGcm(encrypted, validKey)).toThrow();
    });

    it('rechaza un AAD aunque el payload se cifrara sin AAD', () => {
      const encrypted = encryptAesGcm(Buffer.from('sin aad'), validKey);

      expect(() => decryptAesGcm(encrypted, validKey, aad)).toThrow();
    });

    it('sin AAD mantiene el esquema [IV12][tag16][ct]', () => {
      const encrypted = encryptAesGcm(Buffer.from('abc'), validKey);

      expect(encrypted.length).toBe(12 + 16 + 3);
    });

    it('rechaza un tag truncado (authTagLength fijo en 16)', () => {
      const plaintext = Buffer.from('contenido largo para truncar');
      const encrypted = encryptAesGcm(plaintext, validKey);
      // Un tag de 4 bytes seguido del ciphertext desplazado no debe aceptarse.
      const truncated = Buffer.concat([
        encrypted.subarray(0, 12),
        encrypted.subarray(12, 16),
      ]);

      expect(() => decryptAesGcm(truncated, validKey)).toThrow();
    });
  });

  describe('loadBase64Key', () => {
    it('decodifica una clave base64 válida de 32 bytes', () => {
      const raw = validKey.toString('base64');

      const key = loadBase64Key(raw, 'GOOGLE_TOKEN_ENCRYPTION_KEY');

      expect(key.equals(validKey)).toBe(true);
    });

    it('lanza con el nombre de la env var si no está definida', () => {
      expect(() =>
        loadBase64Key(undefined, 'GOOGLE_TOKEN_ENCRYPTION_KEY'),
      ).toThrow(/GOOGLE_TOKEN_ENCRYPTION_KEY no está definida/);
    });

    it('lanza con el nombre de la env var si no decodifica a 32 bytes', () => {
      const shortKey = Buffer.alloc(16, 1).toString('base64');

      expect(() =>
        loadBase64Key(shortKey, 'GOOGLE_TOKEN_ENCRYPTION_KEY'),
      ).toThrow(/GOOGLE_TOKEN_ENCRYPTION_KEY inválida/);
    });
  });
});
