import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '../../../prisma/migrations');

const TABLE_NAME = String.raw`(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?`;
const CREATE_TABLE = new RegExp(String.raw`CREATE TABLE\s+${TABLE_NAME}`, 'gi');
const ENABLE_RLS = new RegExp(
  String.raw`ALTER TABLE\s+(?:ONLY\s+)?${TABLE_NAME}\s+ENABLE ROW LEVEL SECURITY`,
  'gi',
);

function collectTables(sql: string, pattern: RegExp): string[] {
  return [...sql.matchAll(pattern)].map((match) => match[1]);
}

function readMigrations(): string {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      readFileSync(join(MIGRATIONS_DIR, entry.name, 'migration.sql'), 'utf8'),
    )
    .join('\n');
}

describe('migrations: Row Level Security', () => {
  it('enables RLS on every table created in the public schema', () => {
    const sql = readMigrations();
    const created = collectTables(sql, CREATE_TABLE);
    const withRls = new Set(collectTables(sql, ENABLE_RLS));

    const withoutRls = created.filter((table) => !withRls.has(table));

    expect(created.length).toBeGreaterThan(0);
    expect(withoutRls).toEqual([]);
  });
});
