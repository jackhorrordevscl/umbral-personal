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

    // Issue #398: tras rotar y recifrar todo, la variable base (clave id 0)
    // puede retirarse del entorno si el llavero tiene otra clave activa.
    describe('con la clave id 0 retirada (issue #398)', () => {
      it('arranca solo con el llavero y un id activo distinto de 0', () => {
        const ring = buildKeyring(undefined, `5:${raw5},7:${raw7}`, '5', NAME);

        expect(ring.activeKeyId).toBe(5);
        expect(ring.keys.has(0)).toBe(false);
        expect(ring.keys.get(7)?.equals(key7)).toBe(true);
      });

      it('trata la variable base vacía como retirada', () => {
        const ring = buildKeyring('  ', `5:${raw5}`, '5', NAME);

        expect(ring.keys.has(0)).toBe(false);
        expect(ring.activeKeyId).toBe(5);
      });

      it('rechaza si no hay id activo y el valor por defecto sería el 0 retirado', () => {
        expect(() =>
          buildKeyring(undefined, `5:${raw5}`, undefined, NAME),
        ).toThrow(/TEST_ENCRYPTION_KEY_ACTIVE_KEY_ID/);
      });

      it('rechaza un id activo 0 explícito si la clave id 0 no existe', () => {
        expect(() => buildKeyring(undefined, `5:${raw5}`, '0', NAME)).toThrow(
          /TEST_ENCRYPTION_KEY_ACTIVE_KEY_ID/,
        );
      });

      it('sigue fallando si no existe ninguna clave utilizable', () => {
        expect(() =>
          buildKeyring(undefined, undefined, undefined, NAME),
        ).toThrow(/TEST_ENCRYPTION_KEY no está definida/);
        expect(() => buildKeyring(undefined, '  ', '5', NAME)).toThrow(
          /TEST_ENCRYPTION_KEY no está definida/,
        );
      });

      it('sigue validando la variable base si está definida pero es inválida', () => {
        expect(() => buildKeyring('abc', `5:${raw5}`, '5', NAME)).toThrow(
          /TEST_ENCRYPTION_KEY inválida/,
        );
      });

      it('descifra lo cifrado con una clave del llavero sin la clave id 0', () => {
        const withZero = ringWith('5');
        const retired = buildKeyring(
          undefined,
          `5:${raw5},7:${raw7}`,
          '5',
          NAME,
        );
        const encrypted = encryptWithKeyring(Buffer.from('dato'), withZero);

        expect(decryptWithKeyring(encrypted, retired).toString()).toBe('dato');
        expect(resolvePayloadKeyId(encrypted, retired)).toBe(5);
      });

      it('no puede leer un payload que sigue cifrado con la clave id 0', () => {
        const withZero = ringWith('0');
        const retired = buildKeyring(undefined, `5:${raw5}`, '5', NAME);
        const encrypted = encryptWithKeyring(Buffer.from('dato'), withZero);
        const legacy = encryptAesGcm(Buffer.from('dato'), key0);

        expect(() => decryptWithKeyring(encrypted, retired)).toThrow();
        expect(() => decryptWithKeyring(legacy, retired)).toThrow();
      });
    });
  });

  describe('encryptWithKeyring / decryptWithKeyring', () => {
    it('hace roundtrip con el id activo 0 y escribe la cabecera', () => {
      const ring = ringWith();
      const plaintext = Buffer.from('contenido');

      const payload = encryptWithKeyring(plaintext, ring);

      expect(payload.subarray(0, 4)).toEqual(
        Buffer.from([0x55, 0x4b, 0x02, 0x00]),
      );
      expect(decryptWithKeyring(payload, ring).equals(plaintext)).toBe(true);
    });

    it('cifra con la clave activa rotada y escribe su id', () => {
      const ring = ringWith('5');
      const plaintext = Buffer.from('contenido rotado');

      const payload = encryptWithKeyring(plaintext, ring);

      expect(payload[3]).toBe(5);
      expect(decryptWithKeyring(payload, ring).equals(plaintext)).toBe(true);
      const aad = Buffer.concat([payload.subarray(0, 4), Buffer.from(NAME)]);
      expect(() => decryptAesGcm(payload.subarray(4), key0, aad)).toThrow();
      expect(
        decryptAesGcm(payload.subarray(4), key5, aad).equals(plaintext),
      ).toBe(true);
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

  describe('formato 0x02 con AAD', () => {
    const DOC = 'DOCUMENT_ENCRYPTION_KEY';
    const GOOGLE = 'GOOGLE_TOKEN_ENCRYPTION_KEY';
    const ringFor = (name: string, activeId?: string) =>
      buildKeyring(raw0, `5:${raw5},7:${raw7}`, activeId, name);

    // Construye a mano un payload 0x01 (T3a, sin AAD).
    function v1Payload(plaintext: Buffer, keyId: number, key: Buffer) {
      return Buffer.concat([
        Buffer.from([0x55, 0x4b, 0x01, keyId]),
        encryptAesGcm(plaintext, key),
      ]);
    }

    it('emite exactamente 55 4B 02 <keyId>', () => {
      const payload = encryptWithKeyring(Buffer.from('a'), ringFor(DOC, '7'));

      expect(payload.subarray(0, 4)).toEqual(
        Buffer.from([0x55, 0x4b, 0x02, 0x07]),
      );
      expect(payload.length).toBe(4 + 12 + 16 + 1);
    });

    it('hace roundtrip con claves de ids distintos', () => {
      for (const active of ['0', '5', '7']) {
        const ring = ringFor(DOC, active);
        const payload = encryptWithKeyring(Buffer.from('dato'), ring);

        expect(payload[3]).toBe(Number(active));
        expect(decryptWithKeyring(payload, ring).toString()).toBe('dato');
      }
    });

    it('lee 0x01 sin AAD, 0x02 y legacy con el mismo llavero', () => {
      const ring = ringFor(DOC, '7');

      const v1 = v1Payload(Buffer.from('uno'), 5, key5);
      const v2 = encryptWithKeyring(Buffer.from('dos'), ring);
      const legacy = encryptAesGcm(Buffer.from('tres'), key0);

      expect(decryptWithKeyring(v1, ring).toString()).toBe('uno');
      expect(decryptWithKeyring(v2, ring).toString()).toBe('dos');
      expect(decryptWithKeyring(legacy, ring).toString()).toBe('tres');
    });

    it('falla con la etiqueta de otro dataset (mismas claves)', () => {
      const payload = encryptWithKeyring(Buffer.from('doc'), ringFor(DOC, '5'));

      expect(() => decryptWithKeyring(payload, ringFor(GOOGLE, '5'))).toThrow();
    });

    it('usa las etiquetas documents, google, payment y mfa', () => {
      const names: [string, string][] = [
        ['DOCUMENT_ENCRYPTION_KEY', 'documents'],
        ['GOOGLE_TOKEN_ENCRYPTION_KEY', 'google'],
        ['PAYMENT_CREDENTIALS_ENCRYPTION_KEY', 'payment'],
        ['MFA_SECRET_ENCRYPTION_KEY', 'mfa'],
      ];
      for (const [name, label] of names) {
        const ring = ringFor(name, '5');
        const payload = encryptWithKeyring(Buffer.from('x'), ring);
        const aad = Buffer.concat([payload.subarray(0, 4), Buffer.from(label)]);

        expect(decryptAesGcm(payload.subarray(4), key5, aad).toString()).toBe(
          'x',
        );
      }
    });

    it('para un nombre desconocido usa el propio nombre como etiqueta', () => {
      const ring = ringWith('5');
      const payload = encryptWithKeyring(Buffer.from('x'), ring);
      const aad = Buffer.concat([payload.subarray(0, 4), Buffer.from(NAME)]);

      expect(decryptAesGcm(payload.subarray(4), key5, aad).toString()).toBe(
        'x',
      );
    });

    it('falla si se altera el keyId de la cabecera aunque la clave sea la misma', () => {
      const sameKeyRing = buildKeyring(raw0, `5:${raw5},7:${raw5}`, '5', DOC);
      const payload = encryptWithKeyring(Buffer.from('x'), sameKeyRing);
      payload[3] = 7;

      expect(() => decryptWithKeyring(payload, sameKeyRing)).toThrow();
    });

    it('falla si se degrada la versión de la cabecera a 0x01', () => {
      const ring = ringFor(DOC, '5');
      const payload = encryptWithKeyring(Buffer.from('x'), ring);
      payload[2] = 0x01;

      expect(() => decryptWithKeyring(payload, ring)).toThrow();
    });

    it('falla si se altera el tag o el ciphertext', () => {
      const ring = ringFor(DOC, '5');
      const tagTampered = encryptWithKeyring(Buffer.from('abc'), ring);
      tagTampered[4 + 12] ^= 0x01;
      const ctTampered = encryptWithKeyring(Buffer.from('abc'), ring);
      ctTampered[ctTampered.length - 1] ^= 0x01;

      expect(() => decryptWithKeyring(tagTampered, ring)).toThrow();
      expect(() => decryptWithKeyring(ctTampered, ring)).toThrow();
    });

    it('falla con un keyId fuera del llavero sin degradar a legacy', () => {
      const writer = buildKeyring(raw0, `9:${raw7}`, '9', DOC);
      const payload = encryptWithKeyring(Buffer.from('x'), writer);

      expect(() => decryptWithKeyring(payload, ringFor(DOC))).toThrow();
    });

    it('lanza un Error con payloads más cortos que cabecera+IV+tag', () => {
      const ring = ringFor(DOC, '5');
      for (const length of [0, 3, 4, 5, 20, 31]) {
        const short = Buffer.alloc(length);
        short.set([0x55, 0x4b, 0x02, 0x05].slice(0, length));

        expect(() => decryptWithKeyring(short, ring)).toThrow();
      }
    });

    it('lee como legacy un payload cuyo IV empieza con 55 4B 02', () => {
      const ring = ringFor(DOC, '5');
      const plaintext = Buffer.from('legacy con IV que imita 0x02');
      const iv = Buffer.concat([
        Buffer.from([0x55, 0x4b, 0x02, 0x05]),
        Buffer.alloc(8, 4),
      ]);
      const legacy = legacyPayloadWithIv(iv, plaintext, key0);

      expect(decryptWithKeyring(legacy, ring).equals(plaintext)).toBe(true);
      expect(inspectPayload(legacy, ring)).toEqual({
        keyId: 0,
        versioned: false,
        formatVersion: 'legacy',
      });
    });
  });

  describe('texto (enc:v3 / enc:v2 / enc:v1)', () => {
    it('hace roundtrip con el formato enc:v3:<keyId>:', () => {
      const ring = ringWith('5');

      const text = encryptTextWithKeyring(Buffer.from('JBSWY3DP'), ring);

      expect(text.startsWith('enc:v3:5:')).toBe(true);
      expect(decryptTextWithKeyring(text, ring).toString()).toBe('JBSWY3DP');
    });

    it('hace roundtrip de enc:v3 con ids distintos y lee enc:v2 sin AAD', () => {
      for (const active of ['0', '5', '7']) {
        const ring = ringWith(active);
        const text = encryptTextWithKeyring(Buffer.from('mfa'), ring);

        expect(text.startsWith(`enc:v3:${active}:`)).toBe(true);
        expect(decryptTextWithKeyring(text, ring).toString()).toBe('mfa');
      }
      const v2 = `enc:v2:5:${encryptAesGcm(Buffer.from('viejo'), key5).toString('base64')}`;

      expect(decryptTextWithKeyring(v2, ringWith('7')).toString()).toBe(
        'viejo',
      );
    });

    it('enc:v3 falla con otra etiqueta de dataset', () => {
      const build = (name: string) =>
        buildKeyring(raw0, `5:${raw5}`, '5', name);
      const text = encryptTextWithKeyring(
        Buffer.from('mfa'),
        build('MFA_SECRET_ENCRYPTION_KEY'),
      );

      expect(() =>
        decryptTextWithKeyring(text, build('GOOGLE_TOKEN_ENCRYPTION_KEY')),
      ).toThrow();
    });

    it('enc:v3 falla si se cambia el keyId o la versión del prefijo', () => {
      const ring = buildKeyring(raw0, `5:${raw5},7:${raw5}`, '5', NAME);
      const text = encryptTextWithKeyring(Buffer.from('mfa'), ring);

      expect(() =>
        decryptTextWithKeyring(text.replace('enc:v3:5:', 'enc:v3:7:'), ring),
      ).toThrow();
      expect(() =>
        decryptTextWithKeyring(text.replace('enc:v3:5:', 'enc:v2:5:'), ring),
      ).toThrow();
    });

    it('lee enc:v1:<base64> como clave id 0', () => {
      const ring = ringWith('5');
      const legacy = `enc:v1:${encryptAesGcm(Buffer.from('mfa'), key0).toString('base64')}`;

      expect(decryptTextWithKeyring(legacy, ring).toString()).toBe('mfa');
      expect(resolveTextKeyId(legacy)).toBe(0);
    });

    it('lanza con un keyId desconocido en enc:v3', () => {
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

  // issue #486: con contexto el texto sale en enc:v4 y queda ligado a él.
  describe('texto ligado a un contexto (enc:v4)', () => {
    const CTX = 'patient/p-1/consultReason';
    const clinical = (activeId?: string) =>
      buildKeyring(
        raw0,
        `5:${raw5},7:${raw7}`,
        activeId,
        'CLINICAL_TEXT_ENCRYPTION_KEY',
      );

    it('hace roundtrip con el mismo contexto y escribe enc:v4:<keyId>:', () => {
      const ring = clinical('5');
      const text = encryptTextWithKeyring(Buffer.from('nota'), ring, CTX);

      expect(text.startsWith('enc:v4:5:')).toBe(true);
      expect(decryptTextWithKeyring(text, ring, CTX).toString()).toBe('nota');
    });

    it('no descifra con otro paciente, otro campo ni sin contexto', () => {
      const ring = clinical('5');
      const text = encryptTextWithKeyring(Buffer.from('nota'), ring, CTX);

      expect(() =>
        decryptTextWithKeyring(text, ring, 'patient/p-2/consultReason'),
      ).toThrow();
      expect(() =>
        decryptTextWithKeyring(text, ring, 'patient/p-1/intervention'),
      ).toThrow();
      expect(() => decryptTextWithKeyring(text, ring)).toThrow(/contexto/);
    });

    it('no descifra con otra etiqueta de dataset ni con el keyId o la versión alterados', () => {
      const ring = clinical('5');
      const text = encryptTextWithKeyring(Buffer.from('nota'), ring, CTX);
      const other = buildKeyring(
        raw0,
        `5:${raw5}`,
        '5',
        'GOOGLE_TOKEN_ENCRYPTION_KEY',
      );
      const twoKeys = buildKeyring(
        raw0,
        `5:${raw5},7:${raw5}`,
        '5',
        'CLINICAL_TEXT_ENCRYPTION_KEY',
      );

      expect(() => decryptTextWithKeyring(text, other, CTX)).toThrow();
      expect(() =>
        decryptTextWithKeyring(
          text.replace('enc:v4:5:', 'enc:v4:7:'),
          twoKeys,
          CTX,
        ),
      ).toThrow();
      expect(() =>
        decryptTextWithKeyring(
          text.replace('enc:v4:5:', 'enc:v3:5:'),
          ring,
          CTX,
        ),
      ).toThrow();
    });

    it('rechaza un contexto vacío al cifrar', () => {
      expect(() =>
        encryptTextWithKeyring(Buffer.from('nota'), clinical('5'), ''),
      ).toThrow(/vacío/);
    });

    it('sigue leyendo enc:v3 ignorando el contexto y sin contexto escribe enc:v3', () => {
      const ring = clinical('5');
      const v3 = encryptTextWithKeyring(Buffer.from('viejo'), ring);

      expect(v3.startsWith('enc:v3:5:')).toBe(true);
      expect(decryptTextWithKeyring(v3, ring, CTX).toString()).toBe('viejo');
    });

    it('inspectText y resolveTextKeyId reconocen enc:v4', () => {
      const text = encryptTextWithKeyring(Buffer.from('a'), clinical('7'), CTX);

      expect(inspectText(text)).toEqual({ keyId: 7, format: 'v4' });
      expect(resolveTextKeyId(text)).toBe(7);
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

    it('informa el keyId de un texto enc:v3', () => {
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
        formatVersion: 'legacy',
      });
      expect(inspectPayload(versioned, ring)).toEqual({
        keyId: 0,
        versioned: true,
        formatVersion: 'v2',
      });
    });

    it('informa el keyId de un payload versionado con otra clave', () => {
      const ring = ringWith('5');
      const payload = encryptWithKeyring(Buffer.from('a'), ring);

      expect(inspectPayload(payload, ring)).toEqual({
        keyId: 5,
        versioned: true,
        formatVersion: 'v2',
      });
    });

    it('distingue un payload 0x01 de uno 0x02', () => {
      const ring = ringWith('5');
      const v1 = Buffer.concat([
        Buffer.from([0x55, 0x4b, 0x01, 0x05]),
        encryptAesGcm(Buffer.from('a'), key5),
      ]);

      expect(inspectPayload(v1, ring)).toEqual({
        keyId: 5,
        versioned: true,
        formatVersion: 'v1',
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
        formatVersion: 'legacy',
      });
    });

    it('lanza si el payload no se puede descifrar', () => {
      const payload = encryptAesGcm(Buffer.from('a'), Buffer.alloc(32, 99));

      expect(() => inspectPayload(payload, ringWith())).toThrow();
    });

    it('clasifica texto plano, enc:v1, enc:v2 y enc:v3', () => {
      const ring = ringWith('7');
      const v1 = `enc:v1:${encryptAesGcm(Buffer.from('a'), key0).toString('base64')}`;
      const v2 = `enc:v2:7:${encryptAesGcm(Buffer.from('a'), key7).toString('base64')}`;
      const v3 = encryptTextWithKeyring(Buffer.from('a'), ring);

      expect(inspectText('JBSWY3DPEHPK3PXP')).toEqual({
        keyId: null,
        format: 'plaintext',
      });
      expect(inspectText(v1)).toEqual({ keyId: 0, format: 'v1' });
      expect(inspectText(v2)).toEqual({ keyId: 7, format: 'v2' });
      expect(inspectText(v3)).toEqual({ keyId: 7, format: 'v3' });
    });

    it('lanza ante un enc:v2 o enc:v3 con keyId inválido', () => {
      expect(() => inspectText('enc:v2:x:abc')).toThrow();
      expect(() => inspectText('enc:v3:x:abc')).toThrow();
    });
  });
});
