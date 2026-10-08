import { decryptAesGcm, encryptAesGcm, loadBase64Key } from './aes-gcm';

// ADR 0005 (issue #382): llavero y sobre versionado sobre las primitivas
// AES-256-GCM de aes-gcm.ts. Los datos nuevos llevan una cabecera con el id de
// la clave; los datos sin cabecera se leen como clave id 0 (la variable de
// entorno original, sin cambios).
//
// Binario: [0x55 0x4B][formato 0x01][keyId][IV12][tag16][ciphertext]
// Texto:   enc:v2:<keyId>:<base64(IV|tag|ct)>  (enc:v1:<base64> = id 0)

const HEADER_MAGIC = Buffer.from([0x55, 0x4b]);
const FORMAT_VERSION = 0x01;
const HEADER_LENGTH = 4;
const LEGACY_KEY_ID = 0;
const MIN_EXTRA_KEY_ID = 1;
const MAX_KEY_ID = 255;
const TEXT_V1_PREFIX = 'enc:v1:';
const TEXT_V2_PREFIX = 'enc:v2:';

export interface Keyring {
  keys: Map<number, Buffer>;
  activeKeyId: number;
}

function parseKeyId(
  raw: string,
  min: number,
  envVarName: string,
  context: string,
): number {
  const trimmed = raw.trim();
  const id = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isInteger(id) || id < min || id > MAX_KEY_ID) {
    throw new Error(
      `${envVarName} inválida: ${context} debe ser un entero entre ${min} y ${MAX_KEY_ID} (obtenido: "${trimmed}")`,
    );
  }
  return id;
}

// La clave id 0 es obligatoria y usa las mismas reglas que loadBase64Key.
// <NOMBRE>_KEYRING agrega claves "id:base64,id:base64" y
// <NOMBRE>_ACTIVE_KEY_ID elige con cuál se cifra (por defecto 0).
export function buildKeyring(
  legacyRaw: string | undefined,
  keyringRaw: string | undefined,
  activeIdRaw: string | undefined,
  envVarName: string,
): Keyring {
  const keys = new Map<number, Buffer>();
  keys.set(LEGACY_KEY_ID, loadBase64Key(legacyRaw, envVarName));

  const keyringName = `${envVarName}_KEYRING`;
  if (keyringRaw && keyringRaw.trim() !== '') {
    for (const entry of keyringRaw.split(',')) {
      const separator = entry.indexOf(':');
      if (separator === -1) {
        throw new Error(
          `${keyringName} inválida: cada entrada debe tener el formato id:base64 (obtenido: "${entry.trim()}")`,
        );
      }
      const id = parseKeyId(
        entry.slice(0, separator),
        MIN_EXTRA_KEY_ID,
        keyringName,
        'el id de clave',
      );
      if (keys.has(id)) {
        throw new Error(`${keyringName} inválida: id ${id} duplicado`);
      }
      keys.set(
        id,
        loadBase64Key(entry.slice(separator + 1).trim(), keyringName),
      );
    }
  }

  const activeName = `${envVarName}_ACTIVE_KEY_ID`;
  let activeKeyId = LEGACY_KEY_ID;
  if (activeIdRaw && activeIdRaw.trim() !== '') {
    activeKeyId = parseKeyId(
      activeIdRaw,
      LEGACY_KEY_ID,
      activeName,
      'el id activo',
    );
  }
  if (!keys.has(activeKeyId)) {
    throw new Error(
      `${activeName} inválida: el id ${activeKeyId} no existe en el llavero`,
    );
  }

  return { keys, activeKeyId };
}

function activeKey(keyring: Keyring): Buffer {
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) {
    throw new Error(`Clave activa ${keyring.activeKeyId} ausente del llavero`);
  }
  return key;
}

export function encryptWithKeyring(
  plaintext: Buffer,
  keyring: Keyring,
): Buffer {
  const header = Buffer.concat([
    HEADER_MAGIC,
    Buffer.from([FORMAT_VERSION, keyring.activeKeyId]),
  ]);
  return Buffer.concat([header, encryptAesGcm(plaintext, activeKey(keyring))]);
}

// Como el IV legacy es aleatorio, la cabecera no prueba que el dato sea
// nuevo: si el intento versionado falla la autenticación de GCM, se reintenta
// el payload completo como legacy con la clave id 0. Si ambos fallan, se
// propaga el error de GCM del intento legacy.
function decryptWithKeyId(
  payload: Buffer,
  keyring: Keyring,
): { plaintext: Buffer; keyId: number; versioned: boolean } {
  if (
    payload.length > HEADER_LENGTH &&
    payload[0] === HEADER_MAGIC[0] &&
    payload[1] === HEADER_MAGIC[1] &&
    payload[2] === FORMAT_VERSION
  ) {
    const keyId = payload[3];
    const key = keyring.keys.get(keyId);
    if (key) {
      try {
        return {
          plaintext: decryptAesGcm(payload.subarray(HEADER_LENGTH), key),
          keyId,
          versioned: true,
        };
      } catch {
        // Puede ser un payload legacy cuyo IV imita la cabecera.
      }
    }
  }

  const legacyKey = keyring.keys.get(LEGACY_KEY_ID);
  if (!legacyKey) {
    throw new Error('Llavero sin clave id 0');
  }
  return {
    plaintext: decryptAesGcm(payload, legacyKey),
    keyId: LEGACY_KEY_ID,
    versioned: false,
  };
}

export function decryptWithKeyring(payload: Buffer, keyring: Keyring): Buffer {
  return decryptWithKeyId(payload, keyring).plaintext;
}

// Id de la clave con la que realmente se cifró el payload (legacy => 0).
// Descifra para confirmarlo, porque la cabecera sola es ambigua; lanza si
// ninguna clave puede leerlo.
export function resolvePayloadKeyId(payload: Buffer, keyring: Keyring): number {
  return decryptWithKeyId(payload, keyring).keyId;
}

// Como resolvePayloadKeyId, pero distingue un payload legacy (sin cabecera)
// de uno versionado con keyId 0: ambos informan keyId 0 y solo `versioned`
// los diferencia. Lo usa el script de recifrado (issue #382).
export function inspectPayload(
  payload: Buffer,
  keyring: Keyring,
): { keyId: number; versioned: boolean } {
  const { keyId, versioned } = decryptWithKeyId(payload, keyring);
  return { keyId, versioned };
}

export function encryptTextWithKeyring(
  plaintext: Buffer,
  keyring: Keyring,
): string {
  const body = encryptAesGcm(plaintext, activeKey(keyring)).toString('base64');
  return `${TEXT_V2_PREFIX}${keyring.activeKeyId}:${body}`;
}

function parseText(text: string): { keyId: number; body: Buffer } {
  if (text.startsWith(TEXT_V1_PREFIX)) {
    return {
      keyId: LEGACY_KEY_ID,
      body: Buffer.from(text.slice(TEXT_V1_PREFIX.length), 'base64'),
    };
  }
  if (text.startsWith(TEXT_V2_PREFIX)) {
    const rest = text.slice(TEXT_V2_PREFIX.length);
    const separator = rest.indexOf(':');
    const idRaw = separator === -1 ? '' : rest.slice(0, separator);
    if (!/^\d+$/.test(idRaw) || Number(idRaw) > MAX_KEY_ID) {
      throw new Error('Texto cifrado enc:v2 con keyId inválido');
    }
    return {
      keyId: Number(idRaw),
      body: Buffer.from(rest.slice(separator + 1), 'base64'),
    };
  }
  throw new Error('Texto cifrado con formato desconocido (esperado enc:v1/v2)');
}

export function decryptTextWithKeyring(text: string, keyring: Keyring): Buffer {
  const { keyId, body } = parseText(text);
  const key = keyring.keys.get(keyId);
  if (!key) {
    throw new Error(`Texto cifrado con keyId ${keyId} ausente del llavero`);
  }
  return decryptAesGcm(body, key);
}

// El prefijo del texto es explícito, así que no hace falta el llavero.
export function resolveTextKeyId(text: string): number {
  return parseText(text).keyId;
}

// Clasifica un valor de texto almacenado sin descifrarlo: sin prefijo es
// texto plano (secreto previo al cifrado en reposo, keyId null), enc:v1 es
// legacy (id 0) y enc:v2 trae su keyId. Lanza ante un enc:v2 malformado.
export function inspectText(text: string): {
  keyId: number | null;
  format: 'plaintext' | 'v1' | 'v2';
} {
  if (!text.startsWith(TEXT_V1_PREFIX) && !text.startsWith(TEXT_V2_PREFIX)) {
    return { keyId: null, format: 'plaintext' };
  }
  return {
    keyId: parseText(text).keyId,
    format: text.startsWith(TEXT_V1_PREFIX) ? 'v1' : 'v2',
  };
}
