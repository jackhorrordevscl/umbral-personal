// Issue #382 (ADR 0005): recifra todo dato almacenado con la clave ACTIVA de
// cada llavero y, con --check-retire, verifica que una clave ya no se use.
//
// Standalone, ejecución MANUAL -- NUNCA wireado a `prisma migrate`, app boot ni
// ningún request path (mismo patrón que seed-holidays.ts). Ejecutar SOLO
// después de desplegar el release que escribe en formato versionado (T3b); de
// lo contrario el código desplegado seguiría escribiendo datos con la clave
// vieja y habría que repetir la corrida.
//
//   npx ts-node backend/scripts/reencrypt-keys.ts [flags]
//
// Flags:
//   --apply                          escribe (por defecto es dry-run)
//   --only mfa,google,payment,documents   datasets a procesar (por defecto todos)
//   --limit N                        máximo de filas por dataset
//   --check-retire NOMBRE=id         cuenta las filas que aún usan esa clave
//                                    (ej. DOCUMENT_ENCRYPTION_KEY=0); sale con
//                                    código != 0 si queda alguna o si alguna
//                                    fila no se pudo leer
//
// Salida != 0 si alguna fila falló. Es idempotente y reanudable: las filas ya
// al día se omiten. Nunca imprime plaintext, claves ni ciphertext.
//
// La lógica vive en src/common/crypto/reencrypt.ts (con specs); este archivo
// solo arma los llaveros y los adaptadores de Prisma/B2 (sin tests unitarios).
import * as dotenv from 'dotenv';
// El cliente S3 lee el entorno de forma perezosa: dotenv debe correr antes de
// la primera llamada a B2.
dotenv.config();
import { PrismaClient } from '@prisma/client';
import { buildKeyring, Keyring } from '../src/common/crypto/keyring';
import {
  ArgsError,
  binaryCodec,
  computeExitCode,
  DATASET_KEY_NAMES,
  DatasetName,
  DatasetPort,
  formatReport,
  parseArgs,
  Row,
  runReencrypt,
  Stored,
  textCodec,
} from '../src/common/crypto/reencrypt';
import {
  isPatientDocumentNotFoundError,
  readPatientDocumentBuffer,
  writePatientDocumentBuffer,
} from '../src/common/utils/patient-document-storage.util';

const PAGE_SIZE = 200;
const DOCUMENT_CONCURRENCY = 5;

function keyringFor(name: string): Keyring {
  return buildKeyring(
    process.env[name],
    process.env[`${name}_KEYRING`],
    process.env[`${name}_ACTIVE_KEY_ID`],
    name,
  );
}

// Pagina por cursor de id; incluye filas de usuarios borrados y documentos
// anulados porque no se filtra por deletedAt/voidedAt.
async function* paged<T extends { id: string }>(
  fetchPage: (cursor: string | undefined) => Promise<T[]>,
): AsyncGenerator<T> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    if (page.length === 0) return;
    yield* page;
    if (page.length < PAGE_SIZE) return;
    cursor = page[page.length - 1].id;
  }
}

const pageArgs = (cursor: string | undefined) => ({
  take: PAGE_SIZE,
  orderBy: { id: 'asc' as const },
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

// Prisma 6 devuelve Bytes como Uint8Array.
const toBuffer = (value: Uint8Array | null): Buffer | null =>
  value ? Buffer.from(value) : null;

// Prisma exige Uint8Array<ArrayBuffer>; Uint8Array.from copia a un ArrayBuffer real.
const toBytes = (value: Stored): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(value as Buffer);

function buildPort(
  dataset: DatasetName,
  prisma: PrismaClient,
  keyring: Keyring,
): DatasetPort {
  switch (dataset) {
    case 'mfa':
      return {
        dataset,
        codec: textCodec(keyring),
        list: () =>
          paged(async (cursor) =>
            (
              await prisma.user.findMany({
                where: { mfaSecret: { not: null } },
                select: { id: true, mfaSecret: true },
                ...pageArgs(cursor),
              })
            ).map((u) => ({ id: u.id, value: u.mfaSecret })),
          ),
        read: async (row: Row) => row.value ?? null,
        writeIfUnchanged: async (row, previous, next) => {
          const { count } = await prisma.user.updateMany({
            where: { id: row.id, mfaSecret: previous as string },
            data: { mfaSecret: next as string },
          });
          return count === 1;
        },
      };
    case 'google':
      return {
        dataset,
        codec: binaryCodec(keyring),
        list: () =>
          paged(async (cursor) =>
            (
              await prisma.googleCalendarConnection.findMany({
                where: { refreshTokenEncrypted: { not: null } },
                select: { id: true, refreshTokenEncrypted: true },
                ...pageArgs(cursor),
              })
            ).map((c) => ({
              id: c.id,
              value: toBuffer(c.refreshTokenEncrypted),
            })),
          ),
        read: async (row: Row) => row.value ?? null,
        writeIfUnchanged: async (row, previous, next) => {
          const { count } = await prisma.googleCalendarConnection.updateMany({
            where: { id: row.id, refreshTokenEncrypted: toBytes(previous) },
            data: { refreshTokenEncrypted: toBytes(next) },
          });
          return count === 1;
        },
      };
    case 'payment':
      // No toca credentialVersion: el formato del blob no cambia, solo su cifrado.
      return {
        dataset,
        codec: binaryCodec(keyring),
        list: () =>
          paged(async (cursor) =>
            (
              await prisma.paymentAccount.findMany({
                where: { credentialEncrypted: { not: null } },
                select: { id: true, credentialEncrypted: true },
                ...pageArgs(cursor),
              })
            ).map((a) => ({
              id: a.id,
              value: toBuffer(a.credentialEncrypted),
            })),
          ),
        read: async (row: Row) => row.value ?? null,
        writeIfUnchanged: async (row, previous, next) => {
          const { count } = await prisma.paymentAccount.updateMany({
            where: { id: row.id, credentialEncrypted: toBytes(previous) },
            data: { credentialEncrypted: toBytes(next) },
          });
          return count === 1;
        },
      };
    case 'documents':
      // Se sobrescribe el mismo objeto de B2 (storagePath). B2 no tiene PUT
      // condicional: se relee justo antes de escribir y se descarta si cambió.
      return {
        dataset,
        codec: binaryCodec(keyring),
        concurrency: DOCUMENT_CONCURRENCY,
        isMissingError: isPatientDocumentNotFoundError,
        list: () =>
          paged(async (cursor) =>
            (
              await prisma.patientDocument.findMany({
                select: { id: true, storagePath: true },
                ...pageArgs(cursor),
              })
            ).map((d) => ({ id: d.id, key: d.storagePath })),
          ),
        read: (row: Row) => readPatientDocumentBuffer(row.key as string),
        writeIfUnchanged: async (row, previous, next) => {
          const current = await readPatientDocumentBuffer(row.key as string);
          if (!current.equals(previous as Buffer)) return false;
          await writePatientDocumentBuffer(row.key as string, next as Buffer);
          return true;
        },
      };
  }
}

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof ArgsError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  const prisma = new PrismaClient();
  try {
    // Solo se construyen los llaveros de los datasets elegidos: una clave sin
    // definir de otro dataset no debe bloquear la corrida.
    const ports = args.only.map((dataset) =>
      buildPort(dataset, prisma, keyringFor(DATASET_KEY_NAMES[dataset])),
    );
    const options = {
      apply: args.apply,
      limit: args.limit,
      retireKeyId: args.checkRetire?.keyId,
      log: (line: string) => console.log(line),
    };
    const report = await runReencrypt(ports, options);
    console.log(formatReport(report, options));
    return computeExitCode(report, options);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
