import { createCipheriv } from 'crypto';
import { decryptAesGcm, encryptAesGcm } from './aes-gcm';
import {
  buildKeyring,
  decryptTextWithKeyring,
  decryptWithKeyring,
  encryptTextWithKeyring,
  encryptWithKeyring,
  inspectPayload,
  inspectText,
  resolvePayloadKeyId,
  resolveTextKeyId,
} from './keyring';

describe('keyring', () => {
  const NAME = 'TEST_ENCRYPTION_KEY';
  const key0 = Buffer.alloc(32, 3);
  const key5 = Buffer.alloc(32, 5);
  const key7 = Buffer.alloc(32, 7);
  const raw0 = key0.toString('base64');
  const raw5 = key5.toString('base64');
  const raw7 = key7.toString('base64');

  const ringWith = (activeId?: string) =>
    buildKeyring(raw0, `5:${raw5},7:${raw7}`, activeId, NAME);

  // Payload legacy con un IV elegido a mano, para forzar que los primeros
  // bytes coincidan con la cabecera versionada sin depender de randomBytes.
  function legacyPayloadWithIv(iv: Buffer, plaintext: Buffer, key: Buffer) {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]);
  }

  describe('buildKeyring', () => {
    it('usa solo la clave id 0 si no hay llavero ni id activo', () => {
      const ring = buildKeyring(raw0, undefined, undefined, NAME);

      expect(ring.activeKeyId).toBe(0);
      expect(ring.keys.size).toBe(1);
      expect(ring.keys.get(0)?.equals(key0)).toBe(true);
    });

    it('carga claves extra y el id activo', () => {
      const ring = ringWith('5');

      expect(ring.activeKeyId).toBe(5);
      expect(ring.keys.get(7)?.equals(key7)).toBe(true);
    });

    it('trata cadenas vacías como no definidas', () => {
      const ring = buildKeyring(raw0, '  ', '', NAME);

      expect(ring.activeKeyId).toBe(0);
      expect(ring.keys.size).toBe(1);
    });

    it('exige la clave id 0 (variable legacy)', () => {
      expect(() => buildKeyring(undefined, undefined, undefined, NAME)).toThrow(
        /TEST_ENCRYPTION_KEY no está definida/,
      );
    });

    it('rechaza un id no numérico', () => {
      expect(() => buildKeyring(raw0, `abc:${raw5}`, undefined, NAME)).toThrow(
        /TEST_ENCRYPTION_KEY_KEYRING/,
      );
    });

    it('rechaza ids duplicados', () => {
      expect(() =>
        buildKeyring(raw0, `5:${raw5},5:${raw7}`, undefined, NAME),
      ).toThrow(/duplicado/);
    });

    it('rechaza los ids 0 y 256 en el llavero', () => {
      expect(() => buildKeyring(raw0, `0:${raw5}`, undefined, NAME)).toThrow(
        /TEST_ENCRYPTION_KEY_KEYRING/,
      );
      expect(() => buildKeyring(raw0, `256:${raw5}`, undefined, NAME)).toThrow(
        /TEST_ENCRYPTION_KEY_KEYRING/,
      );
    });

    it('rechaza una entrada sin separador', () => {
      expect(() => buildKeyring(raw0, raw5, undefined, NAME)).toThrow(
        /TEST_ENCRYPTION_KEY_KEYRING/,
      );
    });

    it('rechaza una clave que no decodifica a 32 bytes', () => {
      const short = Buffer.alloc(16, 1).toString('base64');

      expect(() => buildKeyring(raw0, `5:${short}`, undefined, NAME)).toThrow(
        /TEST_ENCRYPTION_KEY_KEYRING inválida/,
      );
    });

    it('rechaza un id activo que no está en el llavero', () => {
      expect(() => ringWith('9')).toThrow(/TEST_ENCRYPTION_KEY_ACTIVE_KEY_ID/);
    });

    it('rechaza un id activo no numérico o fuera de rango', () => {
      expect(() => ringWith('x')).toThrow(/TEST_ENCRYPTION_KEY_ACTIVE_KEY_ID/);
      expect(() => ringWith('256')).toThrow(
        /TEST_ENCRYPTION_KEY_ACTIVE_KEY_ID/,
      );
    });
  });

  describe('encryptWithKeyring / decryptWithKeyring', () => {
    it('hace roundtrip con el id activo 0 y escribe la cabecera', () => {
      const ring = ringWith();
      const plaintext = Buffer.from('contenido');

      const payload = encryptWithKeyring(plaintext, ring);

      expect(payload.subarray(0, 4)).toEqual(
        Buffer.from([0x55, 0x4b, 0x01, 0x00]),
      );
      expect(decryptWithKeyring(payload, ring).equals(plaintext)).toBe(true);
    });

    it('cifra con la clave activa rotada y escribe su id', () => {
      const ring = ringWith('5');
      const plaintext = Buffer.from('contenido rotado');

      const payload = encryptWithKeyring(plaintext, ring);

      expect(payload[3]).toBe(5);
      expect(decryptWithKeyring(payload, ring).equals(plaintext)).toBe(true);
      expect(() => decryptAesGcm(payload.subarray(4), key0)).toThrow();
      expect(decryptAesGcm(payload.subarray(4), key5).equals(plaintext)).toBe(
        true,
      );
    });

    it('lee un payload legacy producido por encryptAesGcm', () => {
      const ring = ringWith('5');
      const plaintext = Buffer.from('dato viejo');

      const legacy = encryptAesGcm(plaintext, key0);

      expect(decryptWithKeyring(legacy, ring).equals(plaintext)).toBe(true);
    });

    it('lee un payload legacy cuyo IV coincide con la cabecera', () => {
      const ring = ringWith('5');
      const plaintext = Buffer.from('legacy con IV engañoso');
      const iv = Buffer.concat([
        Buffer.from([0x55, 0x4b, 0x01, 0x00]),
        Buffer.alloc(8, 9),
      ]);
      const legacy = legacyPayloadWithIv(iv, plaintext, key0);

      expect(decryptWithKeyring(legacy, ring).equals(plaintext)).toBe(true);
      expect(resolvePayloadKeyId(legacy, ring)).toBe(0);
    });

    it('lee un payload legacy cuyo IV apunta a una clave que existe', () => {
      const ring = ringWith('5');
      const plaintext = Buffer.from('legacy con IV hacia id 5');
      const iv = Buffer.concat([
        Buffer.from([0x55, 0x4b, 0x01, 0x05]),
        Buffer.alloc(8, 1),
      ]);
      const legacy = legacyPayloadWithIv(iv, plaintext, key0);

      expect(decryptWithKeyring(legacy, ring).equals(plaintext)).toBe(true);
    });

    it('la clave vieja sigue leyendo datos tras rotar la activa', () => {
      const before = ringWith();
      const payload = encryptWithKeyring(Buffer.from('antes'), before);
      const after = ringWith('7');

      expect(decryptWithKeyring(payload, after).toString()).toBe('antes');
      expect(encryptWithKeyring(Buffer.from('x'), after)[3]).toBe(7);
    });

    it('con un keyId desconocido cae a legacy y luego lanza', () => {
      const writer = buildKeyring(raw0, `9:${raw7}`, '9', NAME);
      const payload = encryptWithKeyring(Buffer.from('secreto'), writer);
      const reader = ringWith();

      expect(() => decryptWithKeyring(payload, reader)).toThrow();
    });

    it('lanza si el ciphertext fue alterado', () => {
      const ring = ringWith('5');
      const payload = encryptWithKeyring(Buffer.from('intacto'), ring);
      payload[payload.length - 1] ^= 0xff;

      expect(() => decryptWithKeyring(payload, ring)).toThrow();
    });

    it('lanza con un payload demasiado corto', () => {
      expect(() => decryptWithKeyring(Buffer.alloc(3), ringWith())).toThrow();
    });
  });

  describe('texto (enc:v2 / enc:v1)', () => {
    it('hace roundtrip con el formato enc:v2:<keyId>:', () => {
      const ring = ringWith('5');

      const text = encryptTextWithKeyring(Buffer.from('JBSWY3DP'), ring);

      expect(text.startsWith('enc:v2:5:')).toBe(true);
      expect(decryptTextWithKeyring(text, ring).toString()).toBe('JBSWY3DP');
    });

    it('lee enc:v1:<base64> como clave id 0', () => {
      const ring = ringWith('5');
      const legacy = `enc:v1:${encryptAesGcm(Buffer.from('mfa'), key0).toString('base64')}`;

      expect(decryptTextWithKeyring(legacy, ring).toString()).toBe('mfa');
      expect(resolveTextKeyId(legacy)).toBe(0);
    });

    it('lanza con un keyId desconocido en enc:v2', () => {
      const writer = buildKeyring(raw0, `9:${raw7}`, '9', NAME);
      const text = encryptTextWithKeyring(Buffer.from('mfa'), writer);

      expect(() => decryptTextWithKeyring(text, ringWith())).toThrow();
    });

    it('lanza con un prefijo desconocido', () => {
      expect(() => decryptTextWithKeyring('plano', ringWith())).toThrow(
        /formato/,
      );
    });

    it('lanza si el texto fue alterado', () => {
      const ring = ringWith('5');
      const text = encryptTextWithKeyring(Buffer.from('mfa'), ring);
      const tampered = text.slice(0, -4) + 'AAAA';

      expect(() => decryptTextWithKeyring(tampered, ring)).toThrow();
    });
  });

  describe('resolvePayloadKeyId / resolveTextKeyId', () => {
    it('informa el keyId de un payload binario versionado', () => {
      const ring = ringWith('5');
      const payload = encryptWithKeyring(Buffer.from('a'), ring);

      expect(resolvePayloadKeyId(payload, ring)).toBe(5);
    });

    it('informa 0 para un payload binario legacy', () => {
      const legacy = encryptAesGcm(Buffer.from('a'), key0);

      expect(resolvePayloadKeyId(legacy, ringWith('5'))).toBe(0);
    });

    it('informa el keyId de un texto enc:v2', () => {
      const text = encryptTextWithKeyring(Buffer.from('a'), ringWith('7'));

      expect(resolveTextKeyId(text)).toBe(7);
    });

    it('lanza si el payload no se puede descifrar con ninguna clave', () => {
      const payload = encryptAesGcm(Buffer.from('a'), Buffer.alloc(32, 99));

      expect(() => resolvePayloadKeyId(payload, ringWith())).toThrow();
    });
  });

  describe('inspectPayload / inspectText', () => {
    it('distingue un payload legacy de uno versionado con id 0', () => {
      const ring = ringWith();
      const legacy = encryptAesGcm(Buffer.from('a'), key0);
      const versioned = encryptWithKeyring(Buffer.from('a'), ring);

      expect(inspectPayload(legacy, ring)).toEqual({
        keyId: 0,
        versioned: false,
      });
      expect(inspectPayload(versioned, ring)).toEqual({
        keyId: 0,
        versioned: true,
      });
    });

    it('informa el keyId de un payload versionado con otra clave', () => {
      const ring = ringWith('5');
      const payload = encryptWithKeyring(Buffer.from('a'), ring);

      expect(inspectPayload(payload, ring)).toEqual({
        keyId: 5,
        versioned: true,
      });
    });

    it('trata como legacy un payload cuyo IV imita la cabecera', () => {
      const iv = Buffer.concat([
        Buffer.from([0x55, 0x4b, 0x01, 0x05]),
        Buffer.alloc(8, 1),
      ]);
      const payload = legacyPayloadWithIv(iv, Buffer.from('a'), key0);

      expect(inspectPayload(payload, ringWith('5'))).toEqual({
        keyId: 0,
        versioned: false,
      });
    });

    it('lanza si el payload no se puede descifrar', () => {
      const payload = encryptAesGcm(Buffer.from('a'), Buffer.alloc(32, 99));

      expect(() => inspectPayload(payload, ringWith())).toThrow();
    });

    it('clasifica texto plano, enc:v1 y enc:v2', () => {
      const ring = ringWith('7');
      const v1 = `enc:v1:${encryptAesGcm(Buffer.from('a'), key0).toString('base64')}`;
      const v2 = encryptTextWithKeyring(Buffer.from('a'), ring);

      expect(inspectText('JBSWY3DPEHPK3PXP')).toEqual({
        keyId: null,
        format: 'plaintext',
      });
      expect(inspectText(v1)).toEqual({ keyId: 0, format: 'v1' });
      expect(inspectText(v2)).toEqual({ keyId: 7, format: 'v2' });
    });

    it('lanza ante un enc:v2 con keyId inválido', () => {
      expect(() => inspectText('enc:v2:x:abc')).toThrow();
    });
  });
});
