// Issue #611: carga de concesiones de suscripción (cuentas exentas de cobro).
// Standalone, ejecución MANUAL -- nunca wireado al arranque ni a un request
// (mismo patrón que notify-document-reupload.ts). Sin rol ADMIN a propósito.
//
//   npx ts-node scripts/grant-subscription.ts <email> [--until YYYY-MM-DD]
//
// Sin --until la concesión es permanente. Si la cuenta ya existe se aplica de
// inmediato (el estado se calcula al leer); si aún no se registra, queda
// esperando y vale al verificar el email. Repetir el comando actualiza la
// vigencia de la misma concesión.
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import { createPrismaAdapter } from '../src/prisma/prisma-adapter';
import { normalizeGrantEmail } from '../src/modules/subscriptions/subscriptions.service';

export function parseArgs(argv: string[]): {
  email: string;
  expiresAt: Date | null;
} {
  const email = argv[0] ? normalizeGrantEmail(argv[0]) : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Uso: grant-subscription.ts <email> [--until YYYY-MM-DD]');
  }
  const untilIdx = argv.indexOf('--until');
  if (untilIdx === -1) return { email, expiresAt: null };
  const raw = argv[untilIdx + 1];
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('--until requiere una fecha YYYY-MM-DD');
  }
  const expiresAt = new Date(`${raw}T23:59:59.999Z`);
  if (Number.isNaN(expiresAt.getTime()))
    throw new Error('--until: fecha inválida');
  return { email, expiresAt };
}

export async function main(argv: string[]): Promise<void> {
  const { email, expiresAt } = parseArgs(argv);
  const prisma = new PrismaClient({ adapter: createPrismaAdapter() });
  try {
    await prisma.subscriptionGrant.upsert({
      where: { email },
      create: { email, expiresAt },
      update: { expiresAt },
    });
    console.log(
      `✅ Concesión ${expiresAt ? `hasta ${expiresAt.toISOString()}` : 'permanente'} para ${email}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
