import { test, expect } from '@playwright/test';

// Public booking flow (issue #419): a patient without an account opens the
// therapist's public link, picks a slot, fills in the form and confirms.
//
// Needs the therapist created by backend/prisma/seed-e2e.ts (keep SLUG in sync
// with PUBLIC_BOOKING_SLUG there) and a backend running with
// PUBLIC_SCHEDULING_ENABLED=true. It needs no credentials. The seed publishes a
// weekly schedule (every day, 09:00-18:00 Chile time) instead of fixed dates,
// so the test never hardcodes a date or time: it books whichever slot is the
// first one the page offers.
//
// Without RESEND_API_KEY the backend skips sending emails, and payments / Google
// Calendar are disabled in CI, so the booking has no external side effects.
const SLUG = 'e2e-reserva-publica';
const THERAPIST_NAME = 'Terapeuta E2E Reserva';

// Valid RUT (check digit included) and fixed patient data: running the suite
// twice against the same database reuses the same patient (matched by email).
const PATIENT = {
  fullName: 'Paciente E2E Reserva',
  rut: '12.345.678-5',
  birthDate: '1990-05-15',
  email: 'paciente-e2e-reserva@example.com',
};

test('un paciente reserva el primer horario disponible desde el link público', async ({ page }) => {
  await page.goto(`/book/${SLUG}`);

  // Therapist profile.
  await expect(page.getByRole('heading', { level: 1, name: THERAPIST_NAME })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agenda tu sesión' })).toBeVisible();

  // Days that have at least one slot are the enabled buttons of the calendar.
  const daysGroup = page.getByRole('group', { name: 'Días con horarios disponibles' });
  const availableDays = daysGroup.getByRole('button', { name: /^Ver horarios del/, disabled: false });
  await expect(daysGroup).toHaveAttribute('aria-busy', 'false');

  // Slots start 24h from now, so on the last day of a month the visible grid
  // may have none left: move on to the next month instead of failing.
  if ((await availableDays.count()) === 0) {
    await page.getByRole('button', { name: 'Mes siguiente' }).click();
    await expect(daysGroup).toHaveAttribute('aria-busy', 'false');
  }
  await expect(availableDays.first()).toBeVisible();
  await availableDays.first().click();

  // First slot of that day. `exact` matters: "Días con horarios disponibles"
  // (the calendar) also contains the substring "Horarios disponibles".
  const slots = page
    .getByRole('group', { name: 'Horarios disponibles', exact: true })
    .getByRole('button');
  await expect(slots.first()).toBeVisible();
  await slots.first().click();
  await expect(slots.first()).toHaveAttribute('aria-pressed', 'true');

  // Booking form.
  await expect(page.getByText('Tus datos')).toBeVisible();
  await page.getByLabel('Nombre completo').fill(PATIENT.fullName);
  await page.getByLabel('RUT').fill(PATIENT.rut);
  await page.getByLabel('Fecha de nacimiento').fill(PATIENT.birthDate);
  await page.getByLabel('Email').fill(PATIENT.email);
  await expect(page.getByTestId('booking-privacy-note')).toBeVisible();

  const bookingResponse = page.waitForResponse(
    (response) => response.url().includes('/book') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  expect((await bookingResponse).status()).toBe(201);

  // Success screen.
  await expect(page.getByRole('heading', { name: '¡Listo!' })).toBeVisible();
  await expect(page.getByText(/Tu sesión quedó agendada para el/)).toBeVisible();
});
