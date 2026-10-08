import {
  decryptTextWithKeyring,
  decryptWithKeyring,
  encryptTextWithKeyring,
  encryptWithKeyring,
  inspectPayload,
  inspectText,
  Keyring,
} from './keyring';

// ADR 0005 (issue #382): lógica del script manual de recifrado. Todo el I/O
// (Prisma, B2) entra por puertos (DatasetPort) para poder probarlo con fakes
// en memoria; el wrapper delgado que los implementa vive en
// backend/scripts/reencrypt-keys.ts.
//
// "Al día" significa formato versionado Y keyId === clave activa. Un dato
// legacy (sin cabecera, clave id 0) siempre se reescribe, aunque la clave
// activa sea la id 0, para que quede con cabecera.

export type DatasetName = 'mfa' | 'google' | 'payment' | 'documents';

export const DATASET_NAMES: readonly DatasetName[] = [
  'mfa',
  'google',
  'payment',
  'documents',
];

// Variable de entorno de la clave de cada dataset (para --check-retire).
export const DATASET_KEY_NAMES: Record<DatasetName, string> = {
  mfa: 'MFA_SECRET_ENCRYPTION_KEY',
  google: 'GOOGLE_TOKEN_ENCRYPTION_KEY',
  payment: 'PAYMENT_CREDENTIALS_ENCRYPTION_KEY',
  documents: 'DOCUMENT_ENCRYPTION_KEY',
};

const MAX_KEY_ID = 255;
const LEGACY_BUCKET = 'legacy(0)';
const PLAINTEXT_BUCKET = 'plaintext';

export type Stored = Buffer | string;

// `key` lleva la clave del objeto externo (storagePath en documentos).
export interface Row {
  id: string;
  key?: string;
  value?: Stored | null;
}

export interface Inspection {
  // null = texto plano sin cifrar (solo MFA).
  keyId: number | null;
  versioned: boolean;
}

export interface ValueCodec {
  activeKeyId: number;
  inspect(value: Stored): Inspection;
  decrypt(value: Stored): Buffer;
  encrypt(plaintext: Buffer): Stored;
}

export interface DatasetPort {
  dataset: DatasetName;
  codec: ValueCodec;
  // Filas candidatas, paginadas o en streaming. Incluye usuarios borrados y
  // documentos anulados; los blobs nulos pueden venir o no (el runner los omite).
  list(): AsyncIterable<Row>;
  // Valor almacenado; null si no hay. Puede lanzar (p. ej. objeto ausente).
  read(row: Row): Promise<Stored | null>;
  // Escritura condicional al valor leído. false = cambió en paralelo.
  writeIfUnchanged(row: Row, previous: Stored, next: Stored): Promise<boolean>;
  isMissingError?(err: unknown): boolean;
  concurrency?: number;
}

export function binaryCodec(keyring: Keyring): ValueCodec {
  return {
    activeKeyId: keyring.activeKeyId,
    inspect: (value) => inspectPayload(value as Buffer, keyring),
    decrypt: (value) => decryptWithKeyring(value as Buffer, keyring),
    encrypt: (plaintext) => encryptWithKeyring(plaintext, keyring),
  };
}

export function textCodec(keyring: Keyring): ValueCodec {
  return {
    activeKeyId: keyring.activeKeyId,
    inspect: (value) => {
      const { keyId, format } = inspectText(value as string);
      return { keyId, versioned: format === 'v2' };
    },
    // El texto sin prefijo es un secreto en claro previo al cifrado en reposo.
    decrypt: (value) => {
      const text = value as string;
      return inspectText(text).format === 'plaintext'
        ? Buffer.from(text, 'utf8')
        : decryptTextWithKeyring(text, keyring);
    },
    encrypt: (plaintext) => encryptTextWithKeyring(plaintext, keyring),
  };
}

export type FailureReason =
  | 'read-failed'
  | 'missing-object'
  | 'decrypt-failed'
  | 'encrypt-failed'
  | 'roundtrip-mismatch'
  | 'write-failed';

export interface DatasetReport {
  dataset: DatasetName;
  scanned: number;
  skippedNull: number;
  upToDate: number;
  wouldReencrypt: number;
  reencrypted: number;
  concurrent: number;
  failed: number;
  usingRetireKey: number;
  byKey: Record<string, number>;
  failures: { id: string; reason: FailureReason }[];
}

export interface RunReport {
  datasets: DatasetReport[];
}

export interface RunOptions {
  apply: boolean;
  limit?: number;
  // Si viene, el runner solo cuenta las filas que usan esa clave.
  retireKeyId?: number;
  // Solo recibe dataset + id de fila + keyId + resultado, nunca contenido.
  log?: (line: string) => void;
}

function bucketOf(inspection: Inspection): string {
  if (inspection.keyId === null) return PLAINTEXT_BUCKET;
  if (!inspection.versioned) return LEGACY_BUCKET;
  return String(inspection.keyId);
}

function isEmpty(value: Stored | null | undefined): value is null | undefined {
  return value === null || value === undefined || value.length === 0;
}

async function processRow(
  port: DatasetPort,
  row: Row,
  options: RunOptions,
  report: DatasetReport,
): Promise<void> {
  const fail = (reason: FailureReason, bucket?: string) => {
    report.failed += 1;
    report.failures.push({ id: row.id, reason });
    options.log?.(
      `${port.dataset} ${row.id} key=${bucket ?? '?'} failed:${reason}`,
    );
  };

  let value: Stored | null;
  try {
    value = await port.read(row);
  } catch (err) {
    fail(port.isMissingError?.(err) ? 'missing-object' : 'read-failed');
    return;
  }
  if (isEmpty(value)) {
    report.skippedNull += 1;
    return;
  }

  let inspection: Inspection;
  let plaintext: Buffer;
  try {
    inspection = port.codec.inspect(value);
    plaintext = port.codec.decrypt(value);
  } catch {
    fail('decrypt-failed');
    return;
  }

  const bucket = bucketOf(inspection);
  report.byKey[bucket] = (report.byKey[bucket] ?? 0) + 1;
  if (
    options.retireKeyId !== undefined &&
    inspection.keyId === options.retireKeyId
  ) {
    report.usingRetireKey += 1;
  }

  if (inspection.versioned && inspection.keyId === port.codec.activeKeyId) {
    report.upToDate += 1;
    return;
  }

  if (!options.apply) {
    report.wouldReencrypt += 1;
    options.log?.(`${port.dataset} ${row.id} key=${bucket} would-reencrypt`);
    return;
  }

  let next: Stored;
  try {
    next = port.codec.encrypt(plaintext);
  } catch {
    fail('encrypt-failed', bucket);
    return;
  }

  // Round-trip: el payload nuevo debe descifrar al mismo plaintext antes de
  // pisar el original.
  try {
    if (!port.codec.decrypt(next).equals(plaintext)) {
      fail('roundtrip-mismatch', bucket);
      return;
    }
  } catch {
    fail('roundtrip-mismatch', bucket);
    return;
  }

  try {
    const written = await port.writeIfUnchanged(row, value, next);
    if (!written) {
      report.concurrent += 1;
      options.log?.(
        `${port.dataset} ${row.id} key=${bucket} concurrent-change`,
      );
      return;
    }
  } catch {
    fail('write-failed', bucket);
    return;
  }
  report.reencrypted += 1;
  options.log?.(`${port.dataset} ${row.id} key=${bucket} reencrypted`);
}

async function runDataset(
  port: DatasetPort,
  options: RunOptions,
): Promise<DatasetReport> {
  const report: DatasetReport = {
    dataset: port.dataset,
    scanned: 0,
    skippedNull: 0,
    upToDate: 0,
    wouldReencrypt: 0,
    reencrypted: 0,
    concurrent: 0,
    failed: 0,
    usingRetireKey: 0,
    byKey: {},
    failures: [],
  };

  const iterator = port.list()[Symbol.asyncIterator]();
  let pulled = 0;
  const pull = async (): Promise<Row | undefined> => {
    if (options.limit !== undefined && pulled >= options.limit) {
      return undefined;
    }
    const next = await iterator.next();
    if (next.done) return undefined;
    pulled += 1;
    report.scanned += 1;
    return next.value;
  };

  const worker = async () => {
    for (let row = await pull(); row; row = await pull()) {
      await processRow(port, row, options, report);
    }
  };

  try {
    const workers = Math.max(1, port.concurrency ?? 1);
    await Promise.all(Array.from({ length: workers }, worker));
  } finally {
    await iterator.return?.();
  }
  return report;
}

export async function runReencrypt(
  ports: DatasetPort[],
  options: RunOptions,
): Promise<RunReport> {
  const datasets: DatasetReport[] = [];
  for (const port of ports) {
    datasets.push(await runDataset(port, options));
  }
  return { datasets };
}

// Código de salida: 1 si alguna fila falló (también bloquea el retiro de una
// clave) o, en --check-retire, si todavía hay filas que usan la clave.
export function computeExitCode(
  report: RunReport,
  options: Pick<RunOptions, 'apply' | 'retireKeyId'>,
): number {
  const failed = report.datasets.some((d) => d.failed > 0);
  const retireBlocked =
    options.retireKeyId !== undefined &&
    report.datasets.some((d) => d.usingRetireKey > 0);
  return failed || retireBlocked ? 1 : 0;
}

function bucketOrder(a: string, b: string): number {
  const rank = (bucket: string) =>
    bucket === LEGACY_BUCKET ? -2 : bucket === PLAINTEXT_BUCKET ? -1 : 0;
  return rank(a) - rank(b) || Number(a) - Number(b) || a.localeCompare(b);
}

export function formatReport(
  report: RunReport,
  options: Pick<RunOptions, 'apply' | 'retireKeyId'>,
): string {
  const lines: string[] = [];
  lines.push(
    options.apply
      ? 'Modo: apply (con escrituras)'
      : 'Modo: dry-run (sin escrituras)',
  );
  const actionHeader = options.apply ? 'recifradas' : 'a recifrar';
  lines.push(
    [
      'dataset'.padEnd(10),
      'analizadas'.padStart(10),
      'al día'.padStart(8),
      actionHeader.padStart(11),
      'concurrentes'.padStart(13),
      'fallidas'.padStart(9),
      'nulas'.padStart(6),
    ].join(' '),
  );
  for (const d of report.datasets) {
    lines.push(
      [
        d.dataset.padEnd(10),
        String(d.scanned).padStart(10),
        String(d.upToDate).padStart(8),
        String(options.apply ? d.reencrypted : d.wouldReencrypt).padStart(11),
        String(d.concurrent).padStart(13),
        String(d.failed).padStart(9),
        String(d.skippedNull).padStart(6),
      ].join(' '),
    );
    const buckets = Object.keys(d.byKey).sort(bucketOrder);
    const detail = buckets.map((k) => `${k}=${d.byKey[k]}`).join(' ');
    lines.push(`  claves: ${detail || '(sin filas)'}`);
    for (const f of d.failures) {
      lines.push(`  fallo: ${d.dataset} ${f.id} ${f.reason}`);
    }
  }
  if (options.retireKeyId !== undefined) {
    const total = report.datasets.reduce((n, d) => n + d.usingRetireKey, 0);
    lines.push(`Filas que usan la clave ${options.retireKeyId}: ${total}`);
  }
  return lines.join('\n');
}

export class ArgsError extends Error {}

export interface ParsedArgs {
  apply: boolean;
  only: DatasetName[];
  limit: number | undefined;
  checkRetire: { keyName: string; keyId: number } | undefined;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let apply = false;
  let only: DatasetName[] | undefined;
  let limit: number | undefined;
  let checkRetire: ParsedArgs['checkRetire'];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new ArgsError(`Argumento inesperado: "${arg}"`);
    }
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const takeValue = (): string => {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') {
        throw new ArgsError(`${flag} requiere un valor`);
      }
      return value;
    };

    switch (flag) {
      case '--apply':
        if (inline !== undefined) throw new ArgsError('--apply no lleva valor');
        apply = true;
        break;
      case '--only': {
        const names = takeValue()
          .split(',')
          .map((n) => n.trim());
        const invalid = names.find(
          (n) => !(DATASET_NAMES as readonly string[]).includes(n),
        );
        if (invalid !== undefined) {
          throw new ArgsError(
            `--only inválido: "${invalid}" (válidos: ${DATASET_NAMES.join(', ')})`,
          );
        }
        only = [...new Set(names)] as DatasetName[];
        break;
      }
      case '--limit': {
        const raw = takeValue();
        const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isSafeInteger(n) || n < 1) {
          throw new ArgsError(`--limit inválido: "${raw}" (entero >= 1)`);
        }
        limit = n;
        break;
      }
      case '--check-retire': {
        const raw = takeValue();
        const sep = raw.lastIndexOf('=');
        const keyName = sep === -1 ? '' : raw.slice(0, sep);
        const idRaw = sep === -1 ? '' : raw.slice(sep + 1);
        if (!Object.values(DATASET_KEY_NAMES).includes(keyName)) {
          throw new ArgsError(
            `--check-retire inválido: "${raw}" (formato NOMBRE=id con NOMBRE en ${Object.values(DATASET_KEY_NAMES).join(', ')})`,
          );
        }
        const keyId = /^\d+$/.test(idRaw) ? Number(idRaw) : NaN;
        if (!Number.isInteger(keyId) || keyId > MAX_KEY_ID) {
          throw new ArgsError(
            `--check-retire inválido: el id debe ser un entero entre 0 y ${MAX_KEY_ID} (obtenido: "${idRaw}")`,
          );
        }
        checkRetire = { keyName, keyId };
        break;
      }
      default:
        throw new ArgsError(`Flag desconocido: ${flag}`);
    }
  }

  if (checkRetire) {
    if (apply) {
      throw new ArgsError('--check-retire no se combina con --apply');
    }
    const dataset = DATASET_NAMES.find(
      (d) => DATASET_KEY_NAMES[d] === checkRetire.keyName,
    ) as DatasetName;
    if (only && !only.includes(dataset)) {
      throw new ArgsError(
        `--only no incluye "${dataset}", el dataset de ${checkRetire.keyName}`,
      );
    }
    only = [dataset];
  }

  return {
    apply,
    only: only ?? [...DATASET_NAMES],
    limit,
    checkRetire,
  };
}
