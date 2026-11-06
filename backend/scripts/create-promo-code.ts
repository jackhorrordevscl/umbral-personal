// Issue #611: alta de códigos promocionales (flyer, QR, redes). Standalone,
// ejecución MANUAL -- nunca wireado al arranque ni a un request (mismo patrón
// que grant-subscription.ts). Sin rol ADMIN a propósito.
//
//   npx ts-node scripts/create-promo-code.ts <CODIGO> --channel <canal>
//     [--max 30] [--trial-days 30] [--valid-days 60]
//
// Valores por defecto del issue: 30 días de prueba, 30 canjes y 60 días de
// vigencia. El código se guarda hasheado en mayúsculas y sin espacios del
// borde; el registro lo compara igual, sin distinguir mayúsculas. Repetir el
// comando con el mismo código actualiza canal, tope, prueba y vigencia, pero
// conserva el conteo de canjes ya hechos (también con un código creado antes de
// la normalización, que se encuentra por su capitalización original).
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import { hashInvitationCode } from '../src/modules/auth/invitation-code.util';
import { createPrismaAdapter } from '../src/prisma/prisma-adapter';

const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE =
  'Uso: create-promo-code.ts <CODIGO> --channel <canal> [--max 30] [--trial-days 30] [--valid-days 60]';

export interface PromoCodeArgs {
  // Normalizado (mayúsculas, sin espacios del borde): es el que se guarda.
  code: string;
  // Tal como se escribió (solo sin espacios del borde): sirve para encontrar
  // un código creado antes de la normalización.
  rawCode: string;
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
  // Issue #633: el registro compara el código sin distinguir mayúsculas.
  const rawCode = argv[0]?.trim() ?? '';
  const code = rawCode.toUpperCase();
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
    rawCode,
    channel,
    trialDays,
    maxRedemptions,
    expiresAt: new Date(now.getTime() + validDays * DAY_MS),
  };
}

export function buildSignupPath(code: string): string {
  return `/signup?promo=${encodeURIComponent(code)}`;
}

// Issue #633: un código creado antes de la normalización se guardó con su
// capitalización original. Si existe, se actualiza esa fila (conserva su
// conteo de canjes) en vez de crear una segunda con el tope en cero.
export async function upsertPromoCode(
  client: Pick<PrismaClient, 'promoCode'>,
  args: PromoCodeArgs,
) {
  const { code, rawCode, channel, trialDays, maxRedemptions, expiresAt } = args;
  const data = { channel, trialDays, maxRedemptions, expiresAt };
  const normalizedHash = hashInvitationCode(code);
  let existing = await client.promoCode.findUnique({
    where: { codeHash: normalizedHash },
  });
  if (!existing && rawCode !== code) {
    existing = await client.promoCode.findUnique({
      where: { codeHash: hashInvitationCode(rawCode) },
    });
  }
  if (existing) {
    return client.promoCode.update({ where: { id: existing.id }, data });
  }
  return client.promoCode.create({
    data: { codeHash: normalizedHash, ...data },
  });
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const { code } = args;
  const prisma = new PrismaClient({ adapter: createPrismaAdapter() });
  try {
    const promo = await upsertPromoCode(prisma, args);
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
