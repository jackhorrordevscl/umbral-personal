import { test, expect } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/axe';

// Payment of a public booking (issue #419, point 2): the patient books, gets a
// "Pagar ahora" link, pays on the (fake) Flow checkout and lands back on Umbral.
//
// It runs against a FAKE Flow (frontend/e2e/support/fake-flow-server.mjs, started
// by playwright.config.ts), never the real sandbox: that one is external, rate
// limited and needs credentials. The fake checks the HMAC signature of every
// backend request, so the test also proves the seeded credentials decrypt and
// the order is signed.
//
// Needs, on top of the public-booking.e2e.ts setup:
//  - the therapist, payment account and patient from backend/prisma/seed-e2e.ts
//    (keep SLUG and PATIENT in sync with it). The patient must already exist with
//    a session fee: one created by the booking itself is never charged;
//  - a backend started with PAYMENTS_ENABLED=true,
//    PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED=true,
//    FLOW_API_BASE_URL=http://127.0.0.1:4010 and
//    BACKEND_PUBLIC_URL=http://localhost:3001 (see the e2e job in ci.yml).
const SLUG = 'e2e-reserva-pago';
const THERAPIST_NAME = 'Terapeuta E2E Pago';
const FAKE_FLOW_URL = 'http://127.0.0.1:4010';
const SESSION_AMOUNT = 25000;

const PATIENT = {
  fullName: 'Paciente E2E Pago',
  rut: '11.111.111-1',
  birthDate: '1988-03-20',
  email: 'paciente-e2e-pago@example.com',
};

interface FakeFlowOrder {
  token: string;
  amount: number;
  currency: string;
  payerEmail: string;
  status: number;
  confirmation: { status: number } | null;
}

test('un paciente reserva, paga en Flow simulado y vuelve a Umbral', async ({ page, request }) => {
  await page.goto(`/book/${SLUG}`);
  await expect(page.getByRole('heading', { level: 1, name: THERAPIST_NAME })).toBeVisible();

  // First slot of the first day that has one (same approach as
  // public-booking.e2e.ts: never hardcode a date).
  const daysGroup = page.getByRole('group', { name: 'Días con horarios disponibles' });
  const availableDays = daysGroup.getByRole('button', { name: /^Ver horarios del/, disabled: false });
  await expect(daysGroup).toHaveAttribute('aria-busy', 'false');
  if ((await availableDays.count()) === 0) {
    await page.getByRole('button', { name: 'Mes siguiente' }).click();
    await expect(daysGroup).toHaveAttribute('aria-busy', 'false');
  }
  await expect(availableDays.first()).toBeVisible();
  await availableDays.first().click();

  const slots = page
    .getByRole('group', { name: 'Horarios disponibles', exact: true })
    .getByRole('button');
  await expect(slots.first()).toBeVisible();
  await slots.first().click();

  await expect(page.getByText('Tus datos')).toBeVisible();
  await page.getByLabel('Nombre completo').fill(PATIENT.fullName);
  await page.getByLabel('RUT').fill(PATIENT.rut);
  await page.getByLabel('Fecha de nacimiento').fill(PATIENT.birthDate);
  await page.getByLabel('Email').fill(PATIENT.email);

  const bookingResponse = page.waitForResponse(
    (response) => response.url().includes('/book') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  expect((await bookingResponse).status()).toBe(201);

  // The charge is created in the background after the booking: the page polls
  // until the payment link shows up.
  await expect(page.getByRole('heading', { name: '¡Listo!' })).toBeVisible();
  const payLink = page.getByRole('link', { name: 'Pagar ahora' });
  await expect(payLink).toBeVisible({ timeout: 20_000 });
  await expectNoA11yViolations(page, { label: 'public booking payment: pay link' });

  const href = (await payLink.getAttribute('href')) ?? '';
  expect(href.startsWith(`${FAKE_FLOW_URL}/pay?token=`)).toBe(true);
  const token = new URL(href).searchParams.get('token') ?? '';

  // The order the backend created in the fake Flow.
  const findOrder = async (): Promise<FakeFlowOrder | undefined> => {
    const orders = (await (await request.get(`${FAKE_FLOW_URL}/__orders`)).json()) as FakeFlowOrder[];
    return orders.find((order) => order.token === token);
  };
  const created = await findOrder();
  expect(created).toMatchObject({
    amount: SESSION_AMOUNT,
    currency: 'CLP',
    payerEmail: PATIENT.email,
    status: 1,
    confirmation: null,
  });

  // Hosted checkout of the fake Flow: pay, and come back to Umbral.
  await payLink.click();
  await expect(page.getByRole('heading', { name: 'Flow simulado' })).toBeVisible();
  await page.getByRole('button', { name: 'Pagar' }).click();

  await expect(page).toHaveURL(/\/pago-recibido\?token=/);
  // The return page reads the real payment status from the backend, so this
  // heading only appears once the charge is PAID in Umbral's own database.
  await expect(page.getByRole('heading', { name: 'Pago recibido' })).toBeVisible();
  await expect(page.getByText(/Recibimos tu pago/)).toBeVisible();
  await expectNoA11yViolations(page, { label: 'public booking payment: return page' });

  // The backend accepted the server-to-server confirmation (it re-queries the
  // order status with its own signed request before answering 200).
  const paid = await findOrder();
  expect(paid).toMatchObject({ status: 2, confirmation: { status: 200 } });
});
