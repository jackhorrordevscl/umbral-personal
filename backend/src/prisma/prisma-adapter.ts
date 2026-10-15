import { PrismaPg } from '@prisma/adapter-pg';

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
  return new PrismaPg({ connectionString });
}
