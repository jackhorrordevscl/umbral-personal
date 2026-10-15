import { PrismaPg } from '@prisma/adapter-pg';

const CONNECTION_TIMEOUT_MS = 5000;

/**
 * Builds the driver adapter every PrismaClient needs since Prisma 7.
 * Runtime connections use DATABASE_URL (the pooled connection); callers
 * that need the direct connection pass it explicitly.
 */
export function createPrismaAdapter(
  connectionString: string | undefined = process.env.DATABASE_URL,
): PrismaPg {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  // pg waits forever for a free connection unless told otherwise; Prisma 6
  // failed after a few seconds, so keep that behavior against the pooler.
  return new PrismaPg({
    connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
}
