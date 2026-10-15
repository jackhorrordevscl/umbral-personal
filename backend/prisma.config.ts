import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma Migrate and `db execute` need the direct connection (port 5432):
// the Schema Engine cannot run through the transaction-mode pooler. The
// runtime client uses DATABASE_URL through a driver adapter instead.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
