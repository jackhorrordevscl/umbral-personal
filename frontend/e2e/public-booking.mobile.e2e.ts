import { test, expect, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers/axe';

// Public booking flow at a phone viewport (issue #419, point 3). Same therapist
// and flow as public-booking.e2e.ts, plus a check that no step overflows the
// screen horizontally.
//
// To avoid racing the desktop spec for the same slot (both run against the same
// database, and locally in parallel), this one books the LAST offered day and
// the LAST slot of that day, while the desktop spec books the first of each.
const SLUG = 'e2e-reserva-publica';
const THERAPIST_NAME = 'Terapeuta E2E Reserva';

// Own RUT: it is unique per therapist, so sharing the desktop spec's RUT with a
// different email would answer 409.
const PATIENT = {
  fullName: 'Paciente E2E Movil',
  rut: '11.111.111-1',
  birthDate: '1990-05-15',
  email: 'paciente-e2e-movil@example.com',
};

async function expectNoHorizontalOverflow(page: Page, step: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `horizontal overflow at: ${step}`).toBeLessThanOrEqual(clientWidth);
}

test('en móvil, un paciente reserva el último horario disponible sin desbordes', async ({ page }) => {
  await page.goto(`/book/${SLUG}`);

  await expect(page.getByRole('heading', { level: 1, name: THERAPIST_NAME })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agenda tu sesión' })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'loaded profile');

  const daysGroup = page.getByRole('group', { name: 'Días con horarios disponibles' });
  const availableDays = daysGroup.getByRole('button', { name: /^Ver horarios del/, disabled: false });
  await expect(daysGroup).toHaveAttribute('aria-busy', 'false');

  if ((await availableDays.count()) === 0) {
    await page.getByRole('button', { name: 'Mes siguiente' }).click();
    await expect(daysGroup).toHaveAttribute('aria-busy', 'false');
  }
  await expect(availableDays.first()).toBeVisible();
  await expectNoA11yViolations(page, { label: 'public booking (mobile): loaded profile' });
  await availableDays.last().click();

  const slots = page
    .getByRole('group', { name: 'Horarios disponibles', exact: true })
    .getByRole('button');
  await expect(slots.first()).toBeVisible();
  await expectNoHorizontalOverflow(page, 'slots listed');
  await slots.last().click();
  await expect(slots.last()).toHaveAttribute('aria-pressed', 'true');

  await expect(page.getByText('Tus datos')).toBeVisible();
  await page.getByLabel('Nombre completo').fill(PATIENT.fullName);
  await page.getByLabel('RUT').fill(PATIENT.rut);
  await page.getByLabel('Fecha de nacimiento').fill(PATIENT.birthDate);
  await page.getByLabel('Email').fill(PATIENT.email);
  await expect(page.getByTestId('booking-privacy-note')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'booking form');
  await expectNoA11yViolations(page, { label: 'public booking (mobile): slot selected with form' });

  const bookingResponse = page.waitForResponse(
    (response) => response.url().includes('/book') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  expect((await bookingResponse).status()).toBe(201);

  await expect(page.getByRole('heading', { name: '¡Listo!' })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'success screen');
  await expectNoA11yViolations(page, { label: 'public booking (mobile): success screen' });
});
