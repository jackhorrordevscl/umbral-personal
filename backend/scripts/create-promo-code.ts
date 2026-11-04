// Issue #611: alta de códigos promocionales (flyer, QR, redes). Standalone,
// ejecución MANUAL -- nunca wireado al arranque ni a un request (mismo patrón
// que grant-subscription.ts). Sin rol ADMIN a propósito.
//
//   npx ts-node scripts/create-promo-code.ts <CODIGO> --channel <canal>
//     [--max 30] [--trial-days 30] [--valid-days 60]
//
// Valores por defecto del issue: 30 días de prueba, 30 canjes y 60 días de
// vigencia. El código se guarda hasheado SIN normalizar: distingue mayúsculas
// y debe ir en el QR exactamente como se escribe aquí. Repetir el comando con
// el mismo código actualiza canal, tope, prueba y vigencia, pero conserva el
// conteo de canjes ya hechos.
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import { hashInvitationCode } from '../src/modules/auth/invitation-code.util';
import { createPrismaAdapter } from '../src/prisma/prisma-adapter';

const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE =
  'Uso: create-promo-code.ts <CODIGO> --channel <canal> [--max 30] [--trial-days 30] [--valid-days 60]';

export interface PromoCodeArgs {
  code: string;
  channel: string;
  trialDays: number;
  maxRedemptions: number;
  expiresAt: Date;
}

function readOption(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requiere un valor`);
  }
  return value;
}

function readPositiveInt(
  argv: string[],
  name: string,
  fallback: number,
  min: number,
): number {
  const raw = readOption(argv, name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    throw new Error(`${name} debe ser un entero >= ${min}`);
  }
  return Number(raw);
}

export function parseArgs(
  argv: string[],
  now: Date = new Date(),
): PromoCodeArgs {
  const code = argv[0]?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(code)) {
    throw new Error(
      `${USAGE}\nEl código admite 4 a 40 caracteres: letras sin tilde, números, guion y guion bajo.`,
    );
  }
  const channel = readOption(argv, '--channel')?.trim();
  if (!channel) throw new Error(USAGE);

  const trialDays = readPositiveInt(argv, '--trial-days', 30, 0);
  const maxRedemptions = readPositiveInt(argv, '--max', 30, 1);
  const validDays = readPositiveInt(argv, '--valid-days', 60, 1);
  return {
    code,
    channel,
    trialDays,
    maxRedemptions,
    expiresAt: new Date(now.getTime() + validDays * DAY_MS),
  };
}

export function buildSignupPath(code: string): string {
  return `/signup?promo=${encodeURIComponent(code)}`;
}

export async function main(argv: string[]): Promise<void> {
  const { code, channel, trialDays, maxRedemptions, expiresAt } =
    parseArgs(argv);
  const prisma = new PrismaClient({ adapter: createPrismaAdapter() });
  try {
    const promo = await prisma.promoCode.upsert({
      where: { codeHash: hashInvitationCode(code) },
      create: {
        codeHash: hashInvitationCode(code),
        channel,
        trialDays,
        maxRedemptions,
        expiresAt,
      },
      update: { channel, trialDays, maxRedemptions, expiresAt },
    });
    const baseUrl = (process.env.FRONTEND_URL ?? '').replace(/\/+$/, '');
    console.log(
      `✅ Código ${code} (canal ${promo.channel}): ${promo.trialDays} días de prueba, ${promo.redemptionCount}/${promo.maxRedemptions} canjes, vence ${promo.expiresAt.toISOString()}`,
    );
    console.log(`   Enlace para el QR: ${baseUrl}${buildSignupPath(code)}`);
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
