import { decryptAesGcm, encryptAesGcm, loadBase64Key } from './aes-gcm';

// ADR 0005 (issue #382): llavero y sobre versionado sobre las primitivas
// AES-256-GCM de aes-gcm.ts. Los datos nuevos llevan una cabecera con el id de
// la clave; los datos sin cabecera se leen como clave id 0 (la variable de
// entorno original, sin cambios).
//
// Binario: [0x55 0x4B][formato][keyId][IV12][tag16][ciphertext]
//   formato 0x02 (vigente): cifrado con AAD = cabecera (magic, formato,
//   keyId) + etiqueta fija del dataset. Una cabecera alterada o un payload
//   movido a otro dataset falla la autenticación.
//   formato 0x01 (T3a): igual pero sin AAD; solo se lee.
// Texto:   enc:v3:<keyId>:<base64(IV|tag|ct)>  (vigente, con AAD)
//          enc:v2:<keyId>:<base64(IV|tag|ct)>  (sin AAD; solo se lee)
//          enc:v1:<base64>                      (legacy, id 0)
//
// AAD binario = [0x55 0x4B][0x02][keyId] + etiqueta UTF-8 del dataset.
// AAD de texto = UTF-8 de "enc:v3:<keyId>:" + etiqueta UTF-8 del dataset.

const HEADER_MAGIC = Buffer.from([0x55, 0x4b]);
const FORMAT_V1 = 0x01;
const FORMAT_V2 = 0x02;
const HEADER_LENGTH = 4;
// Cabecera + IV (12) + tag (16): menos que esto no puede ser versionado.
const MIN_VERSIONED_LENGTH = HEADER_LENGTH + 12 + 16;
const LEGACY_KEY_ID = 0;
const MIN_EXTRA_KEY_ID = 1;
const MAX_KEY_ID = 255;
const TEXT_V1_PREFIX = 'enc:v1:';
const TEXT_V2_PREFIX = 'enc:v2:';
const TEXT_V3_PREFIX = 'enc:v3:';

// Etiquetas fijas de dataset para el AAD, por nombre de variable de entorno.
// Mapa explícito: renombrar una variable no debe cambiar la etiqueta, porque
// los datos ya cifrados dependen de ella.
const DATASET_LABELS: Record<string, string> = {
  DOCUMENT_ENCRYPTION_KEY: 'documents',
  GOOGLE_TOKEN_ENCRYPTION_KEY: 'google',
  PAYMENT_CREDENTIALS_ENCRYPTION_KEY: 'payment',
  MFA_SECRET_ENCRYPTION_KEY: 'mfa',
};

export interface Keyring {
  keys: Map<number, Buffer>;
  activeKeyId: number;
  // Etiqueta de dataset que entra al AAD de los formatos 0x02 y enc:v3.
  datasetLabel: string;
}

export type PayloadFormatVersion = 'legacy' | 'v1' | 'v2';
export type TextFormat = 'plaintext' | 'v1' | 'v2' | 'v3';

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

  return {
    keys,
    activeKeyId,
    datasetLabel: DATASET_LABELS[envVarName] ?? envVarName,
  };
}

function binaryAad(header: Buffer, keyring: Keyring): Buffer {
  return Buffer.concat([header, Buffer.from(keyring.datasetLabel, 'utf8')]);
}

function textAad(keyId: number, keyring: Keyring): Buffer {
  return Buffer.from(
    `${TEXT_V3_PREFIX}${keyId}:${keyring.datasetLabel}`,
    'utf8',
  );
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
    Buffer.from([FORMAT_V2, keyring.activeKeyId]),
  ]);
  return Buffer.concat([
    header,
    encryptAesGcm(plaintext, activeKey(keyring), binaryAad(header, keyring)),
  ]);
}

// Como el IV legacy es aleatorio, la cabecera no prueba que el dato sea
// nuevo: si el intento versionado (0x02 con AAD, 0x01 sin AAD) falla la
// autenticación de GCM, se reintenta el payload completo como legacy con la
// clave id 0. Un 0x02 manipulado o de otro dataset también falla ese reintento
// (la autenticación legacy cubre otros bytes), así que no degrada con éxito.
// Si ambos fallan, se propaga el error de GCM del intento legacy.
function decryptWithKeyId(
  payload: Buffer,
  keyring: Keyring,
): {
  plaintext: Buffer;
  keyId: number;
  versioned: boolean;
  formatVersion: PayloadFormatVersion;
} {
  const version = payload[2];
  if (
    payload.length >= MIN_VERSIONED_LENGTH &&
    payload[0] === HEADER_MAGIC[0] &&
    payload[1] === HEADER_MAGIC[1] &&
    (version === FORMAT_V1 || version === FORMAT_V2)
  ) {
    const keyId = payload[3];
    const key = keyring.keys.get(keyId);
    if (key) {
      const header = payload.subarray(0, HEADER_LENGTH);
      try {
        return {
          plaintext: decryptAesGcm(
            payload.subarray(HEADER_LENGTH),
            key,
            version === FORMAT_V2 ? binaryAad(header, keyring) : undefined,
          ),
          keyId,
          versioned: true,
          formatVersion: version === FORMAT_V2 ? 'v2' : 'v1',
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
    formatVersion: 'legacy',
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
// los diferencia. `formatVersion` indica además si es 0x01 (sin AAD) o el
// vigente 0x02. Lo usa el script de recifrado (issue #382).
export function inspectPayload(
  payload: Buffer,
  keyring: Keyring,
): { keyId: number; versioned: boolean; formatVersion: PayloadFormatVersion } {
  const { keyId, versioned, formatVersion } = decryptWithKeyId(
    payload,
    keyring,
  );
  return { keyId, versioned, formatVersion };
}

export function encryptTextWithKeyring(
  plaintext: Buffer,
  keyring: Keyring,
): string {
  const keyId = keyring.activeKeyId;
  const body = encryptAesGcm(
    plaintext,
    activeKey(keyring),
    textAad(keyId, keyring),
  ).toString('base64');
  return `${TEXT_V3_PREFIX}${keyId}:${body}`;
}

function parseText(text: string): {
  keyId: number;
  body: Buffer;
  format: Exclude<TextFormat, 'plaintext'>;
} {
  if (text.startsWith(TEXT_V1_PREFIX)) {
    return {
      keyId: LEGACY_KEY_ID,
      body: Buffer.from(text.slice(TEXT_V1_PREFIX.length), 'base64'),
      format: 'v1',
    };
  }
  const prefix = text.startsWith(TEXT_V3_PREFIX)
    ? TEXT_V3_PREFIX
    : text.startsWith(TEXT_V2_PREFIX)
      ? TEXT_V2_PREFIX
      : undefined;
  if (prefix) {
    const rest = text.slice(prefix.length);
    const separator = rest.indexOf(':');
    const idRaw = separator === -1 ? '' : rest.slice(0, separator);
    if (!/^\d+$/.test(idRaw) || Number(idRaw) > MAX_KEY_ID) {
      throw new Error(
        `Texto cifrado ${prefix.slice(0, -1)} con keyId inválido`,
      );
    }
    return {
      keyId: Number(idRaw),
      body: Buffer.from(rest.slice(separator + 1), 'base64'),
      format: prefix === TEXT_V3_PREFIX ? 'v3' : 'v2',
    };
  }
  throw new Error(
    'Texto cifrado con formato desconocido (esperado enc:v1/v2/v3)',
  );
}

export function decryptTextWithKeyring(text: string, keyring: Keyring): Buffer {
  const { keyId, body, format } = parseText(text);
  const key = keyring.keys.get(keyId);
  if (!key) {
    throw new Error(`Texto cifrado con keyId ${keyId} ausente del llavero`);
  }
  return decryptAesGcm(
    body,
    key,
    format === 'v3' ? textAad(keyId, keyring) : undefined,
  );
}

// El prefijo del texto es explícito, así que no hace falta el llavero.
export function resolveTextKeyId(text: string): number {
  return parseText(text).keyId;
}

// Clasifica un valor de texto almacenado sin descifrarlo: sin prefijo es
// texto plano (secreto previo al cifrado en reposo, keyId null), enc:v1 es
// legacy (id 0), enc:v2 trae su keyId sin AAD y enc:v3 (vigente) su keyId con
// AAD. Lanza ante un enc:v2/enc:v3 malformado.
export function inspectText(text: string): {
  keyId: number | null;
  format: TextFormat;
} {
  if (
    !text.startsWith(TEXT_V1_PREFIX) &&
    !text.startsWith(TEXT_V2_PREFIX) &&
    !text.startsWith(TEXT_V3_PREFIX)
  ) {
    return { keyId: null, format: 'plaintext' };
  }
  const { keyId, format } = parseText(text);
  return { keyId, format };
}
