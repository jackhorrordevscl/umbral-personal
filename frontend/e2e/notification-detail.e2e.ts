import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

// Verificación manual (issue reportado con captura de pantalla): el modal de
// detalle de notificaciones que reemplaza el truncamiento del dropdown
// (NotificationDetailModal, ver NotificationBell.tsx). Corre solo local,
// contra el Postgres de Docker (nunca producción, nunca CI -- no está en
// ningún workflow), y necesita una cuenta sembrada a mano de antemano:
//
//   node -e "
//     const { PrismaClient } = require('@prisma/client');
//     const argon2 = require('argon2');
//     const prisma = new PrismaClient();
//     (async () => {
//       await prisma.user.upsert({
//         where: { email: process.env.E2E_TEST_EMAIL },
//         update: { passwordHash: await argon2.hash(process.env.E2E_TEST_PASSWORD),
//           mustChangePassword: false, mfaEnabled: true,
//           mfaSecret: process.env.E2E_TEST_MFA_SECRET, emailVerified: true, deletedAt: null },
//         create: { email: process.env.E2E_TEST_EMAIL, name: 'E2E Playwright', role: 'PROFESSIONAL',
//           passwordHash: await argon2.hash(process.env.E2E_TEST_PASSWORD),
//           mustChangePassword: false, mfaEnabled: true, mfaSecret: process.env.E2E_TEST_MFA_SECRET,
//           emailVerified: true },
//       });
//       await prisma.\$disconnect();
//     })();
//   " (correr desde backend/, con esas 3 env vars seteadas)
//
// Credenciales leídas de env, nunca como literal en la fuente -- un literal
// con forma de password/secreto acá dispara "Generic Password" en
// GitGuardian aunque sea de una cuenta 100% local (mismo tipo de falso
// positivo que TEST_SECRET en webhooks.service.spec.ts, PR #178, pero ahí
// alcanzó con partir el literal; acá el detector igual lo marcó por forma).
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la env var ${name} -- ver el comentario de arriba para sembrar la cuenta local y setear E2E_TEST_EMAIL/E2E_TEST_PASSWORD/E2E_TEST_MFA_SECRET antes de correr este e2e.`,
    );
  }
  return value;
}

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? 'e2e-playwright@umbral.local';
const TEST_PASSWORD = requireEnv('E2E_TEST_PASSWORD');
const TEST_MFA_SECRET_BASE32 = requireEnv('E2E_TEST_MFA_SECRET');

function base32Decode(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of base32.replace(/=+$/, '')) {
    const val = alphabet.indexOf(char.toUpperCase());
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// RFC 6238 TOTP, mismos defaults que speakeasy.totp() (paso 30s, 6 dígitos,
// SHA1) -- usado por MfaService en el backend (speakeasy.totp.verify).
function totp(secretBase32: string, stepSeconds = 30, digits = 6): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

test('el clic en una notificación abre el detalle completo, sin truncar', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TEST_EMAIL);
  await page.getByLabel('Contraseña', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();

  await page.getByLabel('Código de verificación MFA de 6 dígitos').fill(totp(TEST_MFA_SECRET_BASE32));
  await page.getByRole('button', { name: 'Verificar' }).click();

  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole('button', { name: /notificaciones/i }).click();
  await page.screenshot({ path: 'e2e/screenshots/01-dropdown-truncado.png' });

  await page.getByRole('button', { name: /Es necesario revisar los documentos legales/ }).click();

  const dialog = page.getByRole('dialog', { name: /Es necesario revisar los documentos legales/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/preferimos avisar antes de que lo notes por tu cuenta/)).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/02-detalle-completo.png' });

  await dialog.getByRole('button', { name: 'Ir ahora' }).click();
  await expect(page).toHaveURL(/\/patients/);
  await expect(dialog).not.toBeVisible();
  // exact:true evita que matchee por substring con headings del Dashboard
  // ("Pacientes recientes", "Origen de pacientes"); timeout largo porque la
  // ruta /patients está lazy-loaded (React.lazy) y su primer chunk puede
  // tardar en compilar bajo el dev server de Vite.
  await expect(
    page.getByRole('heading', { name: 'Pacientes', exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'e2e/screenshots/03-navego-a-patients.png' });
});
