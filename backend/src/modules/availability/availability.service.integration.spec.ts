import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from './availability.service';

/**
 * Judgment-day #501: dos saveSchedule concurrentes del mismo terapeuta hacían
 * deleteMany + createMany de las mismas filas; el segundo esperaba al unique
 * (therapistId, dayOfWeek, startMinute) y, al confirmar el primero, fallaba
 * con P2002 -> 500. Solo Postgres real reproduce la espera por el índice.
 *
 * Requiere DATABASE_URL/DIRECT_URL apuntando a Postgres.
 */
describe('AvailabilityService.saveSchedule (integration, concurrencia real)', () => {
  let prisma: PrismaService;
  let service: AvailabilityService;
  const runId = Date.now();
  let therapistId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const therapist = await prisma.user.create({
      data: {
        email: `availability-concurrency-${runId}@example.com`,
        passwordHash: await argon2.hash('TestPass123!'),
        name: 'Dra. Concurrencia',
      },
    });
    therapistId = therapist.id;
    service = new AvailabilityService(prisma, {
      get: () => undefined,
    } as unknown as ConfigService);
  }, 30000);

  afterAll(async () => {
    await prisma.therapistAvailability.deleteMany({ where: { therapistId } });
    await prisma.user.deleteMany({ where: { id: therapistId } });
    await prisma.onModuleDestroy();
  }, 30000);

  const entries = [
    { dayOfWeek: 1, startMinute: 540, endMinute: 780 },
    { dayOfWeek: 3, startMinute: 840, endMinute: 1080 },
  ];

  it('guardados concurrentes de la misma grilla se resuelven todos y dejan una sola copia', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        service.saveSchedule(therapistId, {
          sessionDurationMinutes: 50,
          entries,
        }),
      ),
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const rows = await prisma.therapistAvailability.findMany({
      where: { therapistId },
    });
    expect(rows).toHaveLength(entries.length);
  }, 30000);

  it('guardados concurrentes con grillas distintas dejan exactamente una de ellas', async () => {
    const gridA = [{ dayOfWeek: 2, startMinute: 600, endMinute: 720 }];
    const gridB = [
      { dayOfWeek: 2, startMinute: 600, endMinute: 660 },
      { dayOfWeek: 4, startMinute: 600, endMinute: 660 },
    ];

    const results = await Promise.allSettled([
      service.saveSchedule(therapistId, {
        sessionDurationMinutes: 50,
        entries: gridA,
      }),
      service.saveSchedule(therapistId, {
        sessionDurationMinutes: 50,
        entries: gridB,
      }),
    ]);

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const rows = await prisma.therapistAvailability.findMany({
      where: { therapistId },
    });
    expect([gridA.length, gridB.length]).toContain(rows.length);
  }, 30000);
});
