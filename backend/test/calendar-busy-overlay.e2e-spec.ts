import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  chileDayKeyFromInstant,
  chileWallTimeToInstant,
  isoWeekdayFromDayKey,
  addDaysToDayKey,
} from '../src/common/utils/chile-time.util';

// Lunes futuro, con margen holgado sobre el mínimo de 24h de anticipación
// (design.md/tasks.md 2.1 patient-self-scheduling) -- computado contra la
// fecha real de ejecución en vez de hardcodear un 2026-06-01 que ya podría
// haber quedado en el pasado (bug detectado en este mismo PR: el fixture
// original usaba una fecha fija, y computeAvailableSlots la descarta por
// MIN_LEAD_TIME_MS/MAX_HORIZON_MS apenas el calendario avanza).
function nextMondayDayKeyWithMargin(): string {
  let dayKey = chileDayKeyFromInstant(new Date());
  while (isoWeekdayFromDayKey(dayKey) !== 1) {
    dayKey = addDaysToDayKey(dayKey, 1);
  }
  return addDaysToDayKey(dayKey, 7); // una semana más de margen
}

/**
 * sdd/public-booking-payment-calendar PR 2 (tasks.md 2.5, design.md
 * "Migration / Rollout" -- rollback plan): CALENDAR_AVAILABILITY_OVERLAY_ENABLED
 * se deja SIN setear (mismo default que producción hoy: apagado) -- a
 * diferencia de public-scheduling.e2e-spec.ts, esta suite NO fuerza el flag
 * a "true" antes de compilar AppModule, justamente porque lo que prueba es
 * el comportamiento cuando está apagado.
 *
 * La prueba real de "byte-idéntico" no es solo pedir disponibilidad y ver
 * que no explota -- eso ya lo prueba public-scheduling.e2e-spec.ts. Acá se
 * siembra un CalendarBusyBlock real en Postgres que, si el overlay
 * estuviera activo, eliminaría un slot puntual del grid -- y se confirma
 * que ese slot sigue presente en la respuesta, probando que computeSlots()
 * ni siquiera lee CalendarBusyBlock con el flag apagado (tasks.md 2.3: "no
 * network call ... during slot computation" y "keep flag-off
 * byte-identical").
 */
describe('Calendar busy overlay — flag apagado (e2e)', () => {
  const ORIGINAL_PUBLIC_SCHEDULING_FLAG = process.env.PUBLIC_SCHEDULING_ENABLED;
  const ORIGINAL_OVERLAY_FLAG =
    process.env.CALENDAR_AVAILABILITY_OVERLAY_ENABLED;

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let therapistId: string;

  const runId = Date.now();
  const mondayDayKey = nextMondayDayKeyWithMargin();
  const rangeFrom = chileWallTimeToInstant(mondayDayKey, 0) as Date;
  const rangeTo = chileWallTimeToInstant(
    addDaysToDayKey(mondayDayKey, 1),
    0,
  ) as Date;
  const slotStart = chileWallTimeToInstant(mondayDayKey, 9 * 60) as Date; // 09:00 Chile
  const slotEnd = new Date(slotStart.getTime() + 50 * 60 * 1000);

  beforeAll(async () => {
    // PUBLIC_SCHEDULING_ENABLED en 'true' para que el endpoint de
    // disponibilidad esté alcanzable (mismo criterio que
    // public-scheduling.e2e-spec.ts) -- CALENDAR_AVAILABILITY_OVERLAY_ENABLED
    // se deja deliberadamente sin tocar.
    process.env.PUBLIC_SCHEDULING_ENABLED = 'true';
    delete process.env.CALENDAR_AVAILABILITY_OVERLAY_ENABLED;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);

    const therapist = await prisma.user.create({
      data: {
        email: `calendar-busy-overlay.${runId}@umbral.cl`,
        passwordHash: 'x',
        name: 'Overlay Flag Off Therapist',
      },
    });
    therapistId = therapist.id;

    // Lunes 09:00-13:00 Chile, sesiones de 50 min -- mismo grid que
    // availability.service.spec.ts.
    await prisma.therapistAvailability.create({
      data: {
        therapistId,
        dayOfWeek: 1,
        startMinute: 9 * 60,
        endMinute: 13 * 60,
      },
    });

    // Overlay "fresco" a propósito -- si el flag estuviera prendido, esto
    // bloquearía el slot de 09:00 Chile. Con el flag apagado, computeSlots()
    // nunca debe siquiera consultar esta tabla.
    await prisma.googleCalendarConnection.create({
      data: {
        therapistId,
        status: 'CONNECTED',
        busySyncedAt: new Date(),
      },
    });
    await prisma.calendarBusyBlock.create({
      data: {
        therapistId,
        startsAt: slotStart,
        endsAt: slotEnd,
      },
    });
  }, 30000);

  afterAll(async () => {
    try {
      await prisma.calendarBusyBlock.deleteMany({ where: { therapistId } });
      await prisma.googleCalendarConnection.deleteMany({
        where: { therapistId },
      });
      await prisma.therapistAvailability.deleteMany({
        where: { therapistId },
      });
      await prisma.user.update({
        where: { id: therapistId },
        data: { deletedAt: new Date() },
      });
    } finally {
      if (ORIGINAL_PUBLIC_SCHEDULING_FLAG === undefined) {
        delete process.env.PUBLIC_SCHEDULING_ENABLED;
      } else {
        process.env.PUBLIC_SCHEDULING_ENABLED = ORIGINAL_PUBLIC_SCHEDULING_FLAG;
      }
      if (ORIGINAL_OVERLAY_FLAG === undefined) {
        delete process.env.CALENDAR_AVAILABILITY_OVERLAY_ENABLED;
      } else {
        process.env.CALENDAR_AVAILABILITY_OVERLAY_ENABLED =
          ORIGINAL_OVERLAY_FLAG;
      }
      await app.close();
    }
  });

  it('la respuesta de disponibilidad incluye el slot que un CalendarBusyBlock real bloquearía si el overlay estuviera activo', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/public/therapists/${therapistId}/availability`)
      .query({
        from: rangeFrom.toISOString(),
        to: rangeTo.toISOString(),
      })
      .expect(200);

    const slots = response.body as Array<{ start: string; end: string }>;
    expect(slots.some((s) => s.start === slotStart.toISOString())).toBe(true);
  });

  it('llamar dos veces (con y sin el CalendarBusyBlock recién sembrado) devuelve exactamente el mismo grid — byte-idéntico', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/v1/public/therapists/${therapistId}/availability`)
      .query({
        from: rangeFrom.toISOString(),
        to: rangeTo.toISOString(),
      })
      .expect(200);

    await prisma.calendarBusyBlock.deleteMany({ where: { therapistId } });

    const after = await request(app.getHttpServer())
      .get(`/api/v1/public/therapists/${therapistId}/availability`)
      .query({
        from: rangeFrom.toISOString(),
        to: rangeTo.toISOString(),
      })
      .expect(200);

    // Reinserta para que afterAll no falle silenciosamente sobre una fila
    // ya borrada (deleteMany es idempotente igual, esto es solo higiene).
    await prisma.calendarBusyBlock.create({
      data: { therapistId, startsAt: slotStart, endsAt: slotEnd },
    });

    expect(after.body).toEqual(before.body);
  });
});
