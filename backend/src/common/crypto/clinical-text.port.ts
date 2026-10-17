import { Prisma, PrismaClient } from '@prisma/client';
import { CONSULTATION_TEXT_KEYS } from '../../modules/consultations/util/consultation-text.util';
import { DISCHARGE_TEXT_FIELDS } from '../../modules/discharges/util/discharge-text.util';
import { DatasetPort, Row, Stored, textCodec } from './reencrypt';
import { Keyring } from './keyring';

// ADR 0004 (opción B) + ADR 0005: puerto de recifrado de los textos clínicos.
// El runner trabaja con un valor por fila; aquí cada columna de texto y cada
// texto de un snapshot de ConsultationHistory es una "fila" lógica con id
// `<tabla>/<idDelRegistro>/<campo>` (nunca contiene el contenido).
const PAGE_SIZE = 200;

// Pagina por cursor de id; no filtra por deletedAt/cancelledAt: las filas
// borradas o canceladas conservan texto clínico y también se recifran.
export async function* paged<T extends { id: string }>(
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

export const pageArgs = (cursor: string | undefined) => ({
  take: PAGE_SIZE,
  orderBy: { id: 'asc' as const },
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

type ColumnRecord = { id: string } & Record<string, unknown>;

interface ColumnDelegate {
  findMany(args: object): Promise<ColumnRecord[]>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

const COLUMN_TABLES: {
  table: string;
  model: 'consultation' | 'treatmentDischarge';
  fields: readonly string[];
}[] = [
  {
    table: 'consultation',
    model: 'consultation',
    fields: CONSULTATION_TEXT_KEYS,
  },
  {
    table: 'discharge',
    model: 'treatmentDischarge',
    fields: DISCHARGE_TEXT_FIELDS,
  },
];

const SNAPSHOT_TABLE = 'history';

const rowId = (table: string, id: string, field: string) =>
  `${table}/${id}/${field}`;

function parseRowId(id: string): { table: string; id: string; field: string } {
  const [table, recordId, field] = id.split('/');
  return { table, id: recordId, field };
}

function isTextObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildClinicalPort(
  prisma: PrismaClient,
  keyring: Keyring,
): DatasetPort {
  const delegateOf = (model: 'consultation' | 'treatmentDischarge') =>
    prisma[model] as unknown as ColumnDelegate;

  async function* listColumns(): AsyncGenerator<Row> {
    for (const { table, model, fields } of COLUMN_TABLES) {
      const delegate = delegateOf(model);
      const select: Record<string, boolean> = { id: true };
      for (const f of fields) select[f] = true;
      const records = paged(
        async (cursor) =>
          await delegate.findMany({
            select,
            ...pageArgs(cursor),
          }),
      );
      for await (const record of records) {
        for (const field of fields) {
          const value = record[field];
          if (typeof value === 'string') {
            yield { id: rowId(table, record.id, field), value };
          }
        }
      }
    }
  }

  async function* listSnapshots(): AsyncGenerator<Row> {
    const records = paged(async (cursor) =>
      prisma.consultationHistory.findMany({
        select: { id: true, snapshot: true },
        ...pageArgs(cursor),
      }),
    );
    for await (const record of records) {
      if (!isTextObject(record.snapshot)) continue;
      for (const field of CONSULTATION_TEXT_KEYS) {
        const value = record.snapshot[field];
        if (typeof value === 'string') {
          yield { id: rowId(SNAPSHOT_TABLE, record.id, field), value };
        }
      }
    }
  }

  return {
    dataset: 'clinical',
    codec: textCodec(keyring),
    async *list() {
      yield* listColumns();
      yield* listSnapshots();
    },
    read: (row: Row) => Promise.resolve(row.value ?? null),
    writeIfUnchanged: async (row, previous: Stored, next: Stored) => {
      const { table, id, field } = parseRowId(row.id);

      if (table === SNAPSHOT_TABLE) {
        // Los snapshots son append-only; el bloqueo de fila basta para que la
        // lectura-modificación-escritura del JSON sea condicional al valor.
        return prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "ConsultationHistory" WHERE id = ${id} FOR UPDATE`;
          const current = await tx.consultationHistory.findUnique({
            where: { id },
            select: { snapshot: true },
          });
          if (!current || !isTextObject(current.snapshot)) return false;
          if (current.snapshot[field] !== previous) return false;
          await tx.consultationHistory.update({
            where: { id },
            data: {
              snapshot: { ...current.snapshot, [field]: next as string },
            } as Prisma.InputJsonObject,
          });
          return true;
        });
      }

      const target = COLUMN_TABLES.find((t) => t.table === table);
      if (!target) return false;
      const { count } = await delegateOf(target.model).updateMany({
        where: { id, [field]: previous },
        data: { [field]: next },
      });
      return count === 1;
    },
  };
}
